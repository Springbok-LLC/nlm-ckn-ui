"""Backend reader of the shared collection maps (nlm-ckn-collection-maps.json).

A search tier (label, synonym, identifier or text) says how a field is matched.
The maps file gives each field of each collection one tier, or null when the
field is not searched, and lists the analyzers each tier is indexed with.
"""

import json
from dataclasses import dataclass
from types import MappingProxyType

from django.conf import settings
from django.dispatch import receiver
from django.test.signals import setting_changed

from arango_api.aql_safety import is_safe_aql_identifier

TIERS = ("label", "synonym", "identifier", "text")


def maps_path():
    # Resolved at call time so override_settings(BASE_DIR=...) takes effect.
    return (
        settings.BASE_DIR / "react" / "src" / "assets" / "nlm-ckn-collection-maps.json"
    )


def all_map_fields(path=None):
    """Union of individual_fields[].field_to_display over every collection."""
    with open(path or maps_path()) as fh:
        maps = dict(json.load(fh)["maps"])
    return frozenset(
        field["field_to_display"]
        for config in maps.values()
        for field in config.get("individual_fields", [])
    )


@dataclass(frozen=True)
class SearchTiers:
    """Immutable: (collection, field) -> tier, and tier -> analyzers."""

    field_tiers: MappingProxyType
    analyzers: MappingProxyType

    def tier_of(self, collection, field):
        """Tier of `field` in `collection`, or None if it is not searched there."""
        return self.field_tiers.get((collection, field))

    def analyzers_of(self, tier):
        """Analyzer names for `tier`; KeyError for an unknown tier."""
        return self.analyzers[tier]

    def tiered_fields(self):
        """Field names with a tier in any collection."""
        return frozenset(field for _, field in self.field_tiers)


def load_search_tiers(path=None):
    """Read and validate the tiers from the maps file; raises ValueError if invalid."""
    with open(path or maps_path(), encoding="utf-8") as fh:
        document = json.load(fh)
    analyzers = document["search_tiers"]
    if set(analyzers) != set(TIERS):
        raise ValueError(f"search_tiers keys must be {TIERS}, got {sorted(analyzers)}")
    for tier, names in analyzers.items():
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise ValueError(f"search_tiers[{tier!r}] must be a list of analyzer names")

    field_tiers, tier_by_name = {}, {}
    for collection, config in document["maps"]:
        for entry in config.get("individual_fields", []):
            field = entry["field_to_display"]
            tier = entry.get("search_tier", "(missing)")
            if tier not in (*TIERS, None):
                raise ValueError(f"{collection}.{field}: bad search_tier {tier!r}")
            if not is_safe_aql_identifier(field):
                raise ValueError(f"{collection}: unsafe field name {field!r}")
            if tier:
                if tier_by_name.setdefault(field, tier) != tier:
                    raise ValueError(f"Field {field!r} has more than one search tier")
                field_tiers[(collection, field)] = tier
    return SearchTiers(
        MappingProxyType(field_tiers),
        MappingProxyType({tier: tuple(names) for tier, names in analyzers.items()}),
    )


_cache = {"value": None}


def get_search_tiers():
    """The tiers of the repo's maps file, loaded once per process."""
    if _cache["value"] is None:
        _cache["value"] = load_search_tiers()
    return _cache["value"]


def reset_cache():
    """Intended for tests."""
    _cache["value"] = None


@receiver(setting_changed)
def _reload_on_base_dir_change(setting, **kwargs):
    if setting == "BASE_DIR":
        reset_cache()
