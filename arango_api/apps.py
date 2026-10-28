from django.apps import AppConfig


class ArangoAPIConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "arango_api"

    def ready(self):
        # The Dockerfile's collectstatic step runs ready(), so an image built
        # without the collection maps fails at build time, not at first search.
        from arango_api.search_tiers import get_search_tiers

        get_search_tiers()
