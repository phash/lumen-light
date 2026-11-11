"""H1: Prozessversion (processVersion) in Adjustments — Lightroom-Semantik.

- Preset ohne Version (null/fehlend) laesst beim Anwenden die Version des
  Bildes unangetastet; nur eine explizite Version (mit Ton-Gruppe) setzt sie.
- Edit-State ohne Version = vor H1 bearbeitet -> 1 (exakt alter Look).
- 1, 2, null gueltig; alles andere 422."""
import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.profile_groups import merge_edit_state
from app.schemas import Adjustments, ImageEditState
from tests.s3_upload import upload_via_init

ZERO_ADJ = {
    "exposure": 0.0, "contrast": 0.0, "highlights": 0.0, "shadows": 0.0,
    "whites": 0.0, "blacks": 0.0, "temperature": 0.0, "tint": 0.0,
    "vibrance": 0.0, "saturation": 0.0,
}

_JPEG_BYTES = b"\xff\xd8\xff\xe0pv-fixture"


async def _preset_by_id(client, headers, preset_id: str) -> dict:
    r = await client.get("/api/v1/presets", headers=headers)
    assert r.status_code == 200, r.text
    return next(p for p in r.json() if p["id"] == preset_id)


async def _make_ready_image(client, headers) -> str:
    init = await client.post(
        "/api/v1/images",
        headers=headers,
        json={
            "filename": "pv.jpg",
            "contentType": "image/jpeg",
            "sizeBytes": len(_JPEG_BYTES),
        },
    )
    assert init.status_code == 201, init.text
    image_id = init.json()["id"]
    upload_via_init(init.json(), _JPEG_BYTES, "image/jpeg")
    conf = await client.post(f"/api/v1/images/{image_id}/confirm", headers=headers)
    assert conf.status_code == 200, conf.text
    return image_id


# ----- Schema -----

def test_fehlendes_feld_im_preset_ist_nicht_gesetzt():
    assert Adjustments.model_validate({}).processVersion is None
    # null wird serialisiert, kein eingesetzter Default.
    assert Adjustments.model_validate(ZERO_ADJ).model_dump()["processVersion"] is None


def test_null_und_version_2_sind_gueltig():
    assert Adjustments.model_validate({"processVersion": None}).processVersion is None
    adj = Adjustments.model_validate({"processVersion": 2})
    assert adj.processVersion == 2
    assert adj.model_dump()["processVersion"] == 2


@pytest.mark.parametrize("value", [0, 3, "2"])
def test_ungueltige_version_wird_abgelehnt(value):
    with pytest.raises(ValidationError):
        Adjustments.model_validate({"processVersion": value})


@pytest.mark.parametrize("adjustments", [{}, {"processVersion": None}])
def test_edit_state_ohne_version_ergibt_1(adjustments):
    state = ImageEditState.model_validate({"adjustments": adjustments})
    assert state.adjustments.processVersion == 1
    assert state.model_dump()["adjustments"]["processVersion"] == 1


# ----- merge_edit_state -----

def _state(pv: int | None) -> dict:
    state = ImageEditState(adjustments=Adjustments()).model_dump()
    if pv is None:
        state["adjustments"].pop("processVersion")
    else:
        state["adjustments"]["processVersion"] = pv
    return state


def _merge(base_pv, preset_adjustments: dict, groups: list[str]) -> dict:
    return merge_edit_state(
        base_state=_state(base_pv),
        preset_adjustments=preset_adjustments,
        preset_masks=[],
        preset_geometry=None,
        enabled=groups,
    )


def test_merge_mit_ton_gruppe_uebernimmt_explizite_preset_version():
    merged = _merge(2, Adjustments(processVersion=1).model_dump(), ["tone"])
    assert merged["adjustments"]["processVersion"] == 1


def test_merge_ohne_ton_gruppe_behaelt_bild_version():
    merged = _merge(2, Adjustments(processVersion=1).model_dump(), ["color"])
    assert merged["adjustments"]["processVersion"] == 2


def test_merge_preset_mit_null_laesst_bild_version_unangetastet():
    merged = _merge(2, Adjustments().model_dump(), ["tone"])
    assert merged["adjustments"]["processVersion"] == 2
    merged = _merge(1, Adjustments().model_dump(), ["tone"])
    assert merged["adjustments"]["processVersion"] == 1


def test_merge_preset_ohne_feld_laesst_bild_version_unangetastet():
    preset_adj = Adjustments(processVersion=2).model_dump()
    preset_adj.pop("processVersion")
    merged = _merge(2, preset_adj, ["tone"])
    assert merged["adjustments"]["processVersion"] == 2
    assert ImageEditState.model_validate(merged).adjustments.processVersion == 2


def test_merge_altes_bild_ohne_feld_und_preset_ohne_version_validiert_zu_1():
    merged = _merge(None, Adjustments().model_dump(), ["tone", "color"])
    assert "processVersion" not in merged["adjustments"]
    assert ImageEditState.model_validate(merged).adjustments.processVersion == 1


# ----- API: Presets -----

async def test_preset_roundtrip_mit_version_2(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "PV2", "adjustments": {**ZERO_ADJ, "processVersion": 2}},
    )
    assert r.status_code == 201, r.text
    assert r.json()["adjustments"]["processVersion"] == 2
    got = await _preset_by_id(client, user_a["headers"], r.json()["id"])
    assert got["adjustments"]["processVersion"] == 2


async def test_preset_ohne_feld_bleibt_ungesetzt(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Alt", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 201, r.text
    assert r.json()["adjustments"]["processVersion"] is None
    got = await _preset_by_id(client, user_a["headers"], r.json()["id"])
    assert got["adjustments"]["processVersion"] is None


async def test_preset_mit_version_3_ergibt_422(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "PV3", "adjustments": {**ZERO_ADJ, "processVersion": 3}},
    )
    assert r.status_code == 422, r.text


async def test_preset_altbestand_ohne_feld_in_db_liest_als_null(client, user_a, db_session):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Bestand", "adjustments": {**ZERO_ADJ, "processVersion": 2}},
    )
    preset_id = r.json()["id"]
    # JSONB wie vor H1: Feld entfernen.
    await db_session.execute(
        text("UPDATE presets SET adjustments = adjustments - 'processVersion' WHERE id = :id"),
        {"id": preset_id},
    )
    await db_session.flush()
    got = await _preset_by_id(client, user_a["headers"], preset_id)
    # Kein eingesetzter Default: null bleibt null.
    assert got["adjustments"]["processVersion"] is None


async def test_default_presets_tragen_keine_version(client, user_a):
    r = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    versions = {p["adjustments"]["processVersion"] for p in r.json()}
    assert versions == {None}


async def test_marketplace_apply_liefert_null_fuer_preset_ohne_version(
    client, user_a, user_b
):
    from tests.test_marketplace import _create_public_preset

    created = await _create_public_preset(client, user_a["headers"], name="pv-null")
    r = await client.post(
        f"/api/v1/marketplace/presets/{created['id']}/apply", headers=user_b["headers"]
    )
    assert r.status_code == 200, r.text
    assert r.json()["adjustments"]["processVersion"] is None


# ----- API: Edit-State -----

async def test_edit_state_roundtrip_mit_version_2(client, user_a):
    image_id = await _make_ready_image(client, user_a["headers"])
    put = await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"exposure": 0.3, "processVersion": 2}},
    )
    assert put.status_code == 204, put.text
    got = await client.get(f"/api/v1/images/{image_id}/edit", headers=user_a["headers"])
    assert got.json()["adjustments"]["processVersion"] == 2


async def test_edit_state_ohne_feld_ergibt_version_1(client, user_a):
    image_id = await _make_ready_image(client, user_a["headers"])
    await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"exposure": 0.3}},
    )
    got = await client.get(f"/api/v1/images/{image_id}/edit", headers=user_a["headers"])
    assert got.json()["adjustments"]["processVersion"] == 1


async def test_edit_state_altbestand_ohne_feld_in_db_liest_als_1(client, user_a, db_session):
    image_id = await _make_ready_image(client, user_a["headers"])
    await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"exposure": 0.3, "processVersion": 2}},
    )
    await db_session.execute(
        text(
            "UPDATE image_edits SET state = state #- '{adjustments,processVersion}' "
            "WHERE image_id = :id"
        ),
        {"id": image_id},
    )
    await db_session.flush()
    got = await client.get(f"/api/v1/images/{image_id}/edit", headers=user_a["headers"])
    assert got.json()["adjustments"]["processVersion"] == 1


async def test_edit_state_mit_version_3_ergibt_422(client, user_a):
    image_id = await _make_ready_image(client, user_a["headers"])
    put = await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"processVersion": 3}},
    )
    assert put.status_code == 422, put.text


# ----- API: Batch-Apply -----

async def _put_edit(client, headers, image_id: str, adjustments: dict) -> None:
    put = await client.put(
        f"/api/v1/images/{image_id}/edit", headers=headers, json={"adjustments": adjustments}
    )
    assert put.status_code == 204, put.text


_preset_counter = iter(range(1_000_000))


async def _apply(client, headers, preset_adjustments: dict, image_id: str, groups: list[str]):
    r = await client.post(
        "/api/v1/presets",
        headers=headers,
        json={"name": f"Look-{next(_preset_counter)}", "adjustments": preset_adjustments},
    )
    assert r.status_code == 201, r.text
    apply = await client.post(
        f"/api/v1/presets/{r.json()['id']}/apply",
        headers=headers,
        json={"imageIds": [image_id], "groups": groups},
    )
    assert apply.status_code == 200, apply.text
    got = await client.get(f"/api/v1/images/{image_id}/edit", headers=headers)
    return got.json()["adjustments"]


async def test_batch_apply_mit_ton_gruppe_setzt_explizite_preset_version(client, user_a):
    h = user_a["headers"]
    image_id = await _make_ready_image(client, h)
    await _put_edit(client, h, image_id, {"processVersion": 2})
    adj = await _apply(client, h, {**ZERO_ADJ, "contrast": 0.3, "processVersion": 1}, image_id, ["tone"])
    assert adj["processVersion"] == 1
    assert adj["contrast"] == 0.3


async def test_batch_apply_preset_ohne_version_laesst_pv2_bild_unangetastet(client, user_a):
    h = user_a["headers"]
    image_id = await _make_ready_image(client, h)
    await _put_edit(client, h, image_id, {"processVersion": 2})
    adj = await _apply(client, h, {**ZERO_ADJ, "contrast": 0.3}, image_id, ["tone"])
    assert adj["processVersion"] == 2
    assert adj["contrast"] == 0.3


async def test_batch_apply_preset_ohne_version_auf_altes_bild_bleibt_1(client, user_a, db_session):
    h = user_a["headers"]
    image_id = await _make_ready_image(client, h)
    await _put_edit(client, h, image_id, {"exposure": 0.2})
    await db_session.execute(
        text(
            "UPDATE image_edits SET state = state #- '{adjustments,processVersion}' "
            "WHERE image_id = :id"
        ),
        {"id": image_id},
    )
    await db_session.flush()
    adj = await _apply(client, h, {**ZERO_ADJ, "contrast": 0.3}, image_id, ["tone"])
    assert adj["processVersion"] == 1


async def test_batch_apply_auf_frisches_bild_ergibt_version_2(client, user_a):
    h = user_a["headers"]
    for groups in (["color"], ["tone"]):
        image_id = await _make_ready_image(client, h)
        adj = await _apply(client, h, {**ZERO_ADJ, "temperature": 0.3}, image_id, groups)
        # Bild ohne gespeicherten Stand gilt als frisch -> PV2 wie im Editor;
        # das Preset ohne Version aendert daran nichts.
        assert adj["processVersion"] == 2
        assert adj["temperature"] == (0.3 if groups == ["color"] else 0.0)
