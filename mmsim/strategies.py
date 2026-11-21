"""Quoting strategies. Each returns vectorised (bid, ask, bid_active, ask_active)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class FixedSpread:
    """Quote mid +/- half_spread on both sides, always."""

    half_spread: float = 0.5
    name: str = "fixed_spread"

    def quotes(self, mid, inventory):
        on = np.ones(mid.shape, dtype=bool)
        return mid - self.half_spread, mid + self.half_spread, on, on


@dataclass(frozen=True)
class InventorySkew:
    """Centre quotes on a reservation price r = mid - skew * q.

    Long inventory (q > 0) lowers both quotes: the bid fills less often and
    the ask more often, which pushes inventory back toward zero.
    """

    half_spread: float = 0.5
    skew: float = 0.05
    name: str = "inventory_skew"

    def quotes(self, mid, inventory):
        r = mid - self.skew * inventory
        on = np.ones(mid.shape, dtype=bool)
        return r - self.half_spread, r + self.half_spread, on, on


@dataclass(frozen=True)
class InventoryLimit:
    """Symmetric quotes, but stop quoting the side that would breach |q| > max."""

    half_spread: float = 0.5
    max_inventory: int = 5
    name: str = "inventory_limit"

    def quotes(self, mid, inventory):
        bid_on = inventory < self.max_inventory
        ask_on = inventory > -self.max_inventory
        return mid - self.half_spread, mid + self.half_spread, bid_on, ask_on


def default_strategies():
    return [FixedSpread(), InventorySkew(), InventoryLimit()]
