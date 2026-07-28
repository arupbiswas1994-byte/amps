"""Predefined checksheet templates, keyed by asset class.

Every asset class gets one or more checksheets (maintenance and/or job-card).
The formats are supplied by the section; fill this registry from them — each
template is plain data, no code. A checksheet filled against a log entry stores
the ticked results on the entry (log_entries.checksheet), referencing the
template by key/name.

Schema per template:
    {
        "key":       stable id, e.g. "vcb-33kv-yearly"
        "name":      human title shown on the sheet
        "applies_to": "maintenance" | "job_card" | "any"
        "classes":   [asset-class names it applies to]  (empty = any class)
        "subtype":   optional maintenance frequency it matches (e.g. "Yearly")
        "items":     [{"key","label","unit"?}]  — one row per check
    }

`unit` (optional) hints the reading's unit (e.g. "MΩ", "bar", "µΩ").
Statuses a filled item can carry: "pass" | "fail" | "na".
"""

# NOTE: seeded with a single generic template so the plumbing is exercisable.
# The section is supplying the real per-asset-class formats — add them here as
# they arrive; the UI and storage need no further changes.
TEMPLATES: list[dict] = [
    {
        "key": "generic-maintenance",
        "name": "General maintenance checksheet",
        "applies_to": "maintenance",
        "classes": [],          # any class until the class-specific sheets land
        "subtype": None,
        "items": [
            {"key": "visual", "label": "Visual inspection — no damage / overheating"},
            {"key": "clean", "label": "Cleaning of equipment & enclosure"},
            {"key": "tightness", "label": "Tightness of connections / terminals"},
            {"key": "ir", "label": "Insulation resistance (Megger)", "unit": "MΩ"},
            {"key": "operation", "label": "Operational / functional test"},
            {"key": "labels", "label": "Labels, danger boards & earthing intact"},
        ],
    },
]


def templates_for(applies_to: str | None = None, asset_class: str | None = None,
                  subtype: str | None = None) -> list[dict]:
    """Templates matching the given context. Empty `classes` = applies to any."""
    out = []
    for t in TEMPLATES:
        if applies_to and t["applies_to"] not in (applies_to, "any"):
            continue
        if asset_class and t.get("classes") and asset_class not in t["classes"]:
            continue
        if subtype and t.get("subtype") and t["subtype"] != subtype:
            continue
        out.append(t)
    return out
