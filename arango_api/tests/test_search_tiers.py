"""Unit tests for the collection-maps reader (no database)."""

import json
import tempfile
from pathlib import Path

from django.apps import apps
from django.test import SimpleTestCase, override_settings

from arango_api.search_tiers import (
    all_map_fields,
    get_search_tiers,
    load_search_tiers,
    reset_cache,
)


ANALYZERS = {"label": ["wildcard-lower"], "synonym": [], "identifier": [], "text": []}


def coll(name, *fields):
    entries = [{"search_tier": t, "field_to_display": f} for f, t in fields]
    return [name, {"individual_fields": entries}]


def doc(*collections, tiers=ANALYZERS):
    return {"search_tiers": tiers, "maps": list(collections)}


class LoadSearchTiersTestCase(SimpleTestCase):
    def write_maps(self, document):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "maps.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        return path

    def test_loads_tiers_per_collection(self):
        path = self.write_maps(
            doc(
                coll("CS", ("dataset_name", None), ("definition", "text")),
                coll("CSD", ("dataset_name", "label"), ("dataset_name", "label")),
            )
        )
        tiers = load_search_tiers(path)
        self.assertIsNone(tiers.tier_of("CS", "dataset_name"))
        self.assertEqual(tiers.tier_of("CSD", "dataset_name"), "label")
        self.assertEqual(tiers.tiered_fields(), {"dataset_name", "definition"})
        self.assertEqual(tiers.analyzers_of("label"), ("wildcard-lower",))
        with self.assertRaises(KeyError):
            tiers.analyzers_of("fuzzy")

    def test_rejects_invalid_documents(self):
        no_key = doc(coll("CS", ("label", "label")))
        del no_key["maps"][0][1]["individual_fields"][0]["search_tier"]
        cases = {
            "search_tiers": doc(tiers={**ANALYZERS, "extra": []}),
            "analyzer": doc(tiers={**ANALYZERS, "text": ["ok", 3]}),
            "missing": no_key,
            "bad search_tier": doc(coll("CS", ("label", "fuzzy"))),
            "unsafe": doc(coll("CS", ("a`b", None))),
            "more than one": doc(
                coll("CS", ("title", "label")), coll("CL", ("title", "text"))
            ),
        }
        for message, document in cases.items():
            with self.subTest(message):
                path = self.write_maps(document)
                with self.assertRaisesRegex(ValueError, message):
                    load_search_tiers(path)


class CachedSearchTiersTestCase(SimpleTestCase):
    def setUp(self):
        self.addCleanup(reset_cache)
        reset_cache()

    def test_real_file_tiers(self):
        tiers = get_search_tiers()
        self.assertEqual(tiers.tier_of("CSD", "dataset_name"), "label")
        self.assertIsNone(tiers.tier_of("CS", "dataset_name"))
        self.assertEqual(tiers.tier_of("NCBITaxon", "_key"), "identifier")
        self.assertIn("label", tiers.tiered_fields())
        self.assertFalse({"_search", "year"} & tiers.tiered_fields())
        self.assertIn("wildcard-lower", tiers.analyzers_of("label"))

    def test_cached_until_reset_or_base_dir_changes(self):
        first = get_search_tiers()
        self.assertIs(get_search_tiers(), first)
        reset_cache()
        self.assertIsNot(get_search_tiers(), first)
        cached = get_search_tiers()
        with override_settings(BASE_DIR=Path(tempfile.gettempdir())):
            pass
        self.assertIsNot(get_search_tiers(), cached)

    def test_ready_raises_when_maps_file_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(BASE_DIR=Path(tmp)), self.assertRaises(
                FileNotFoundError
            ):
                apps.get_app_config("arango_api").ready()


class AllMapFieldsTestCase(SimpleTestCase):
    def test_union_of_field_to_display_across_collections(self):
        maps = {
            "maps": [
                ["CL", {"individual_fields": [{"field_to_display": "label"}]}],
                [
                    "GS",
                    {
                        "individual_fields": [
                            {"field_to_display": "label"},
                            {"field_to_display": "symbol"},
                        ]
                    },
                ],
                ["NOFIELDS", {}],
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp) / "react" / "src" / "assets"
            assets.mkdir(parents=True)
            (assets / "nlm-ckn-collection-maps.json").write_text(json.dumps(maps))
            with override_settings(BASE_DIR=Path(tmp)):
                self.assertEqual(all_map_fields(), frozenset({"label", "symbol"}))

    def test_real_repo_file_contains_known_fields(self):
        fields = all_map_fields()
        self.assertTrue({"label", "_from", "gene_symbol"} <= fields)
