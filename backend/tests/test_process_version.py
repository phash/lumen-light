"""H1: Prozessversion (processVersion) in Adjustments.

Fehlt das Feld (Daten von vor H1), gilt 1 — kein bestehender Edit und
kein Preset aendert sein Aussehen. 2 ist gueltig, alles andere 422."""
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

def test_fehlendes_feld_ergibt_version_1():
    assert Adjustments.model_validate({}).processVersion == 1
    assert Adjustments.model_validate(ZERO_ADJ).model_dump()["processVersion"] == 1


def test_version_2_ist_gueltig():
    adj = Adjustments.model_validate({"processVersion": 2})
    assert adj.processVersion == 2
    assert adj.model_dump()["processVersion"] == 2


@pytest.mark.parametrize("value", [0, 3, "2", None])
def test_ungueltige_version_wird_abgelehnt(value):
    with pytest.raises(ValidationError):
        Adjustments.model_validate({"processVersion": value})


# ----- merge_edit_state -----

def _state(pv: int | None) -> dict:
    state = ImageEditState(adjustments=Adjustments()).model_dump()
    if pv is None:
        state["adjustments"].pop("processVersion")
    else:
        state["adjustments"]["processVersion"] = pv
    return state


def test_merge_mit_ton_gruppe_uebernimmt_preset_version():
    merged = merge_edit_state(
        base_state=_state(2),
        preset_adjustments=Adjustments(processVersion=1).model_dump(),
        preset_masks=[],
        preset_geometry=None,
        enabled=["tone"],
    )
    assert merged["adjustments"]["processVersion"] == 1


def test_merge_ohne_ton_gruppe_behaelt_bild_version():
    merged = merge_edit_state(
        base_state=_state(2),
        preset_adjustments=Adjustments(processVersion=1).model_dump(),
        preset_masks=[],
        preset_geometry=None,
        enabled=["color"],
    )
    assert merged["adjustments"]["processVersion"] == 2


def test_merge_mit_ton_gruppe_und_altem_preset_ohne_feld_ergibt_1():
    preset_adj = Adjustments(processVersion=2).model_dump()
    preset_adj.pop("processVersion")
    merged = merge_edit_state(
        base_state=_state(2),
        preset_adjustments=preset_adj,
        preset_masks=[],
        preset_geometry=None,
        enabled=["tone"],
    )
    assert merged["adjustments"]["processVersion"] == 1
    # Ergebnis bleibt validierbar.
    assert ImageEditState.model_validate(merged).adjustments.processVersion == 1


def test_merge_altes_bild_ohne_feld_validiert_zu_1():
    merged = merge_edit_state(
        base_state=_state(None),
        preset_adjustments=Adjustments(processVersion=2).model_dump(),
        preset_masks=[],
        preset_geometry=None,
        enabled=["color"],
    )
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


async def test_preset_ohne_feld_ergibt_version_1(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Alt", "adjustments": ZERO_ADJ},
    )
    assert r.status_code == 201, r.text
    assert r.json()["adjustments"]["processVersion"] == 1


async def test_preset_mit_version_3_ergibt_422(client, user_a):
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "PV3", "adjustments": {**ZERO_ADJ, "processVersion": 3}},
    )
    assert r.status_code == 422, r.text


async def test_preset_altbestand_ohne_feld_in_db_liest_als_1(client, user_a, db_session):
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
    assert got["adjustments"]["processVersion"] == 1


async def test_default_presets_bleiben_version_1(client, user_a):
    r = await client.get("/api/v1/presets", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    versions = {p["adjustments"]["processVersion"] for p in r.json()}
    assert versions == {1}


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

async def test_batch_apply_mit_ton_gruppe_setzt_preset_version(client, user_a):
    image_id = await _make_ready_image(client, user_a["headers"])
    await client.put(
        f"/api/v1/images/{image_id}/edit",
        headers=user_a["headers"],
        json={"adjustments": {"processVersion": 2}},
    )
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Alt-Look", "adjustments": {**ZERO_ADJ, "contrast": 0.3}},
    )
    preset_id = r.json()["id"]
    apply = await client.post(
        f"/api/v1/presets/{preset_id}/apply",
        headers=user_a["headers"],
        json={"imageIds": [image_id], "groups": ["tone"]},
    )
    assert apply.status_code == 200, apply.text
    got = await client.get(f"/api/v1/images/{image_id}/edit", headers=user_a["headers"])
    assert got.json()["adjustments"]["processVersion"] == 1
    assert got.json()["adjustments"]["contrast"] == 0.3


async def test_batch_apply_ohne_ton_gruppe_auf_frisches_bild_ergibt_version_2(client, user_a):
    image_id = await _make_ready_image(client, user_a["headers"])
    r = await client.post(
        "/api/v1/presets",
        headers=user_a["headers"],
        json={"name": "Farb-Look", "adjustments": {**ZERO_ADJ, "temperature": 0.3}},
    )
    apply = await client.post(
        f"/api/v1/presets/{r.json()['id']}/apply",
        headers=user_a["headers"],
        json={"imageIds": [image_id], "groups": ["color"]},
    )
    assert apply.status_code == 200, apply.text
    got = await client.get(f"/api/v1/images/{image_id}/edit", headers=user_a["headers"])
    # Bild ohne gespeicherten Stand gilt als frisch -> PV2 wie im Editor.
    assert got.json()["adjustments"]["processVersion"] == 2
    assert got.json()["adjustments"]["temperature"] == 0.3
