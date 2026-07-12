"""Module with classes and inheritance for testing class extraction."""

from abc import ABC, abstractmethod
from typing import List, Optional


class Animal(ABC):
    """Abstract base class for animals."""

    def __init__(self, name: str, age: int) -> None:
        self.name = name
        self.age = age

    @abstractmethod
    def speak(self) -> str:
        """Make a sound."""
        pass

    def describe(self) -> str:
        """Describe the animal."""
        return f"{self.name} is {self.age} years old"


class Dog(Animal):
    """A dog that inherits from Animal."""

    breed: str = "Unknown"

    def __init__(self, name: str, age: int, breed: str = "Mixed") -> None:
        super().__init__(name, age)
        self.breed = breed

    def speak(self) -> str:
        """Dogs bark."""
        return "Woof!"

    def fetch(self, item: str) -> str:
        """Fetch an item."""
        return f"{self.name} fetched the {item}"


class Cat(Animal):
    """A cat that inherits from Animal."""

    indoor: bool = True

    def __init__(self, name: str, age: int, indoor: bool = True) -> None:
        super().__init__(name, age)
        self.indoor = indoor

    def speak(self) -> str:
        """Cats meow."""
        return "Meow!"

    def scratch(self) -> str:
        """Scratch something."""
        return f"{self.name} scratches the furniture"


class Pet:
    """Container for a pet with owner info."""

    def __init__(self, animal: Animal, owner: str) -> None:
        self.animal = animal
        self.owner = owner

    @property
    def pet_name(self) -> str:
        """Get pet's name."""
        return self.animal.name

    @classmethod
    def create_dog(cls, name: str, owner: str) -> "Pet":
        """Factory method to create a pet dog."""
        return cls(Dog(name, 1), owner)

    @staticmethod
    def is_valid_name(name: str) -> bool:
        """Check if name is valid."""
        return len(name) > 0 and name.isalpha()


class Shelter:
    """An animal shelter holding multiple animals."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._animals: List[Animal] = []

    def add_animal(self, animal: Animal) -> None:
        """Add an animal to the shelter."""
        self._animals.append(animal)

    def remove_animal(self, name: str) -> Optional[Animal]:
        """Remove and return an animal by name."""
        for i, animal in enumerate(self._animals):
            if animal.name == name:
                return self._animals.pop(i)
        return None

    def list_animals(self) -> List[str]:
        """List all animal names."""
        return [a.name for a in self._animals]

    def __len__(self) -> int:
        """Return number of animals."""
        return len(self._animals)

    def __iter__(self):
        """Iterate over animals."""
        return iter(self._animals)


__all__ = ["Animal", "Dog", "Cat", "Pet", "Shelter"]
