"""Synthetic demo data for AMPS.

ALL DATA HERE IS FICTIONAL — generic industrial examples for demonstration.
No real organization's assets, locations or records appear in this repository.
"""

DEMO_LOCATIONS = [
    ("Demo Plant", "site", None),
    ("Substation-1", "station", "Demo Plant"),
    ("Workshop Bay-A", "bay", "Demo Plant"),
]

DEMO_ASSET_CLASSES = [
    "Transformer", "HT Panel", "LT Panel", "PLC", "Motor", "Crane Hoist",
]

DEMO_ASSETS = [
    ("TRF-0001", "33kV/415V Distribution Transformer", "Transformer", "Substation-1"),
    ("HTP-0001", "33kV Incomer Panel", "HT Panel", "Substation-1"),
    ("PLC-0001", "Bay Automation PLC", "PLC", "Workshop Bay-A"),
    ("CRN-0001", "10T EOT Crane Hoist", "Crane Hoist", "Workshop Bay-A"),
]

DEMO_PM = [
    ("TRF-0001", "Oil BDV test", "half_yearly"),
    ("HTP-0001", "Contact resistance check", "yearly"),
    ("PLC-0001", "Battery & backup verification", "quarterly"),
    ("CRN-0001", "Brake & limit-switch inspection", "monthly"),
]

if __name__ == "__main__":
    print("v0.1 skeleton — DB seeding lands with the SQLAlchemy layer in v0.2.")
    print(f"{len(DEMO_ASSETS)} synthetic assets defined across {len(DEMO_LOCATIONS)} demo locations.")
