"""IR fixture whose set repr varies with PYTHONHASHSEED unless canonicalized."""

VALUES = {"beta", "alpha", "gamma"}


def values() -> set[str]:
    return VALUES
