"""H2b: Bewertung, Farblabel, Markierung — PATCH einzeln/Batch, Filter,
Sortierung, Export, CHECK-Constraints."""
from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models import Image
from tests.images import upload_image


async def _patch(client, headers, image_id: str, body: dict):
    return await client.patch(f"/api/v1/images/{image_id}", headers=headers, json=body)


async def _batch(client, headers, body: dict):
    return await client.patch("/api/v1/images", headers=headers, json=body)


async def _list(client, headers, query: str = ""):
    r = await client.get(f"/api/v1/images{query}", headers=headers)
    assert r.status_code == 200, r.text
    return r


def _ids(r) -> list[str]:
    return [i["id"] for i in r.json()]


# ---------- ImageOut-Defaults ----------


async def test_neues_bild_hat_default_metadaten(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    body = (await _list(client, user_a["headers"])).json()
    item = next(i for i in body if i["id"] == image_id)
    assert item["rating"] == 0
    assert item["colorLabel"] is None
    assert item["flag"] == "none"


# ---------- PATCH /images/{id} ----------


async def test_patch_setzt_alle_drei_felder(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    r = await _patch(
        client, user_a["headers"], image_id,
        {"rating": 3, "colorLabel": "green", "flag": "pick"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["rating"], body["colorLabel"], body["flag"]) == (3, "green", "pick")
    assert body["id"] == image_id


async def test_patch_aendert_nur_gesendete_felder(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    await _patch(client, user_a["headers"], image_id, {"rating": 4, "colorLabel": "red"})
    r = await _patch(client, user_a["headers"], image_id, {"flag": "reject"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["rating"], body["colorLabel"], body["flag"]) == (4, "red", "reject")


async def test_patch_color_label_null_loescht_label(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    await _patch(client, user_a["headers"], image_id, {"colorLabel": "blue", "rating": 2})
    r = await _patch(client, user_a["headers"], image_id, {"colorLabel": None})
    assert r.status_code == 200, r.text
    assert r.json()["colorLabel"] is None
    assert r.json()["rating"] == 2


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"rating": 6},
        {"rating": -1},
        {"rating": None},
        {"flag": None},
        {"flag": "maybe"},
        {"colorLabel": "orange"},
        {"rating": 2, "unknown": 1},
    ],
)
async def test_patch_ungueltige_bodies_422(client, user_a, body):
    image_id = await upload_image(client, user_a["headers"])
    r = await _patch(client, user_a["headers"], image_id, body)
    assert r.status_code == 422, r.text


async def test_patch_fremdes_bild_404(client, user_a, user_b):
    image_id = await upload_image(client, user_a["headers"])
    r = await _patch(client, user_b["headers"], image_id, {"rating": 5})
    assert r.status_code == 404
    mine = (await _list(client, user_a["headers"])).json()
    assert next(i for i in mine if i["id"] == image_id)["rating"] == 0


async def test_patch_unbekanntes_bild_404(client, user_a):
    r = await _patch(client, user_a["headers"], str(uuid4()), {"rating": 1})
    assert r.status_code == 404


# ---------- PATCH /images (Batch) ----------


async def test_batch_setzt_felder_fuer_alle(client, user_a):
    a = await upload_image(client, user_a["headers"], filename="a.jpg")
    b = await upload_image(client, user_a["headers"], filename="b.jpg")
    r = await _batch(
        client, user_a["headers"], {"ids": [b, a], "rating": 5, "colorLabel": "purple"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["id"] for i in body] == [b, a]
    assert all(i["rating"] == 5 and i["colorLabel"] == "purple" for i in body)
    assert all(i["flag"] == "none" for i in body)


async def test_batch_mit_fremder_id_404_ohne_teilupdate(client, user_a, user_b):
    mine = await upload_image(client, user_a["headers"])
    foreign = await upload_image(client, user_b["headers"])
    r = await _batch(client, user_a["headers"], {"ids": [mine, foreign], "flag": "pick"})
    assert r.status_code == 404
    listing = (await _list(client, user_a["headers"])).json()
    assert next(i for i in listing if i["id"] == mine)["flag"] == "none"
    other = (await _list(client, user_b["headers"])).json()
    assert next(i for i in other if i["id"] == foreign)["flag"] == "none"


async def test_batch_mit_unbekannter_id_404(client, user_a):
    mine = await upload_image(client, user_a["headers"])
    r = await _batch(client, user_a["headers"], {"ids": [mine, str(uuid4())], "rating": 1})
    assert r.status_code == 404


@pytest.mark.parametrize(
    "make_body",
    [
        lambda i: {"ids": [], "rating": 1},
        lambda i: {"ids": [i, i], "rating": 1},
        lambda i: {"ids": [i]},
        lambda i: {"ids": [i], "rating": 9},
        lambda i: {"ids": [str(uuid4()) for _ in range(501)], "rating": 1},
        lambda i: {"ids": [i], "rating": 1, "extra": True},
    ],
)
async def test_batch_ungueltige_bodies_422(client, user_a, make_body):
    image_id = await upload_image(client, user_a["headers"])
    r = await _batch(client, user_a["headers"], make_body(image_id))
    assert r.status_code == 422, r.text


async def test_batch_mit_500_ids_ist_erlaubt_bis_zur_eigentumspruefung(client, user_a):
    """500 ist die Grenze: Validierung laesst durch, unbekannte IDs -> 404."""
    r = await _batch(
        client, user_a["headers"], {"ids": [str(uuid4()) for _ in range(500)], "rating": 1}
    )
    assert r.status_code == 404


# ---------- GET /images Filter + Sortierung ----------


async def _seed(client, headers) -> dict[str, str]:
    ids = {
        "c": await upload_image(client, headers, filename="c.jpg"),
        "a": await upload_image(client, headers, filename="a.jpg"),
        "b": await upload_image(client, headers, filename="b.jpg"),
        "d": await upload_image(client, headers, filename="d.jpg"),
    }
    await _patch(client, headers, ids["a"], {"rating": 5, "colorLabel": "red", "flag": "pick"})
    await _patch(client, headers, ids["b"], {"rating": 3, "colorLabel": "blue"})
    await _patch(client, headers, ids["c"], {"rating": 1, "flag": "reject"})
    return ids


async def test_filter_min_rating(client, user_a):
    ids = await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?minRating=3")
    assert set(_ids(r)) == {ids["a"], ids["b"]}
    assert r.headers["X-Total-Count"] == "2"


async def test_filter_min_rating_0_liefert_alles(client, user_a):
    await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?minRating=0")
    assert len(_ids(r)) == 4


async def test_filter_color_label_mehrfach(client, user_a):
    ids = await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?colorLabel=red&colorLabel=blue")
    assert set(_ids(r)) == {ids["a"], ids["b"]}
    r = await _list(client, user_a["headers"], "?colorLabel=blue")
    assert _ids(r) == [ids["b"]]


async def test_filter_color_label_none_liefert_bilder_ohne_label(client, user_a):
    """H2d: colorLabel=none -> color_label IS NULL."""
    ids = await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?colorLabel=none")
    assert set(_ids(r)) == {ids["c"], ids["d"]}
    assert r.headers["X-Total-Count"] == "2"


async def test_filter_color_label_none_kombiniert_mit_farbe(client, user_a):
    """none plus Farbe = ODER (ohne Label oder rot)."""
    ids = await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?colorLabel=none&colorLabel=red")
    assert set(_ids(r)) == {ids["a"], ids["c"], ids["d"]}


async def test_filter_color_label_none_mit_anderen_filtern(client, user_a):
    ids = await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?colorLabel=none&minRating=1")
    assert _ids(r) == [ids["c"]]


async def test_patch_color_label_none_string_bleibt_422(client, user_a):
    """'none' ist nur ein Filterwert, kein speicherbares Label."""
    image_id = await upload_image(client, user_a["headers"])
    r = await client.patch(
        f"/api/v1/images/{image_id}", headers=user_a["headers"], json={"colorLabel": "none"}
    )
    assert r.status_code == 422


async def test_filter_flag(client, user_a):
    ids = await _seed(client, user_a["headers"])
    assert _ids(await _list(client, user_a["headers"], "?flag=reject")) == [ids["c"]]
    assert set(_ids(await _list(client, user_a["headers"], "?flag=none"))) == {
        ids["b"], ids["d"],
    }


async def test_filter_kombiniert(client, user_a):
    ids = await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?minRating=1&flag=pick&colorLabel=red")
    assert _ids(r) == [ids["a"]]


async def test_sort_name_asc(client, user_a):
    ids = await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?sort=name_asc")
    assert _ids(r) == [ids["a"], ids["b"], ids["c"], ids["d"]]


async def test_sort_rating_desc(client, user_a):
    ids = await _seed(client, user_a["headers"])
    r = await _list(client, user_a["headers"], "?sort=rating_desc")
    assert _ids(r) == [ids["a"], ids["b"], ids["c"], ids["d"]]


async def test_sort_created_desc_und_asc_sind_umkehrbar_bei_gleicher_zeit(
    client, user_a, db_session
):
    """Im Test laufen alle Requests in einer Transaktion (gleiches now());
    die Zeiten werden explizit gesetzt, damit die Ordnung pruefbar ist."""
    ids = await _seed(client, user_a["headers"])
    for n, key in enumerate(["c", "a", "b", "d"]):
        await db_session.execute(
            text(
                "UPDATE images SET created_at = now() + make_interval(secs => :n) "
                "WHERE id = :id"
            ),
            {"n": n, "id": UUID(ids[key])},
        )
    asc = _ids(await _list(client, user_a["headers"], "?sort=created_asc"))
    desc = _ids(await _list(client, user_a["headers"]))
    assert asc == [ids["c"], ids["a"], ids["b"], ids["d"]]
    assert desc == list(reversed(asc))


async def test_pagination_ist_deterministisch_bei_gleichstand(client, user_a):
    """Gleiche Bewertung -> id als Tiebreaker: Seiten ueberlappen nicht."""
    for n in range(5):
        await upload_image(client, user_a["headers"], filename=f"same-{n}.jpg")
    pages = []
    for offset in range(0, 5, 2):
        r = await _list(client, user_a["headers"], f"?sort=rating_desc&limit=2&offset={offset}")
        assert r.headers["X-Total-Count"] == "5"
        pages.extend(_ids(r))
    assert len(pages) == 5 and len(set(pages)) == 5


@pytest.mark.parametrize(
    "query",
    [
        "?minRating=6",
        "?minRating=-1",
        "?minRating=x",
        "?colorLabel=orange",
        "?colorLabel=None",
        "?colorLabel=",
        "?colorLabel=null",
        "?flag=maybe",
        "?sort=rating_asc",
    ],
)
async def test_ungueltige_filter_422(client, user_a, query):
    r = await client.get(f"/api/v1/images{query}", headers=user_a["headers"])
    assert r.status_code == 422, r.text


async def test_legacy_sort_werte_bleiben_gueltig(client, user_a):
    await _seed(client, user_a["headers"])
    for sort in ("-created_at", "created_at", "original_filename", "-original_filename"):
        await _list(client, user_a["headers"], f"?sort={sort}")


async def test_filter_sieht_keine_fremden_bilder(client, user_a, user_b):
    await _seed(client, user_b["headers"])
    r = await _list(client, user_a["headers"], "?minRating=1")
    assert _ids(r) == []


# ---------- Export ----------


async def test_export_enthaelt_metadaten(client, user_a):
    image_id = await upload_image(client, user_a["headers"])
    await _patch(
        client, user_a["headers"], image_id,
        {"rating": 4, "colorLabel": "yellow", "flag": "pick"},
    )
    r = await client.get("/api/v1/auth/me/export", headers=user_a["headers"])
    assert r.status_code == 200, r.text
    img = next(i for i in r.json()["images"] if i["id"] == image_id)
    assert (img["rating"], img["colorLabel"], img["flag"]) == (4, "yellow", "pick")


# ---------- CHECK-Constraints (DB) ----------


@pytest.mark.parametrize(
    "column,value",
    [("rating", 6), ("rating", -1), ("color_label", "orange"), ("flag", "maybe")],
)
async def test_check_constraints_greifen_in_der_db(client, user_a, db_session, column, value):
    image_id = await upload_image(client, user_a["headers"])
    nested = await db_session.begin_nested()
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(f"UPDATE images SET {column} = :v WHERE id = :id"),
            {"v": value, "id": UUID(image_id)},
        )
    await nested.rollback()
    row = (
        await db_session.execute(select(Image).where(Image.id == UUID(image_id)))
    ).scalar_one()
    assert row.rating == 0
