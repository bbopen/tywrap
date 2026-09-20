"""Real CPU tensor returns for generated Torch float16 checks."""

import torch


def half_values() -> torch.HalfTensor:
    return torch.tensor([1.5, -2.25, -0.0], dtype=torch.float16)


def wrong_half_values() -> torch.HalfTensor:
    return torch.tensor([1.5, -2.25], dtype=torch.float32)
