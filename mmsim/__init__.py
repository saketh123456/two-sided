"""Synthetic market-making simulator."""
from .model import MarketParams, SimResult, arrival_rate, fill_probability, simulate
from .strategies import FixedSpread, InventoryLimit, InventorySkew, default_strategies

__all__ = [
    "MarketParams",
    "SimResult",
    "arrival_rate",
    "fill_probability",
    "simulate",
    "FixedSpread",
    "InventorySkew",
    "InventoryLimit",
    "default_strategies",
]
