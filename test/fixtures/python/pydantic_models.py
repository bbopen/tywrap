"""
Pydantic models test fixture.
Tests Pydantic v1 and v2 model definitions, validators, and field types.
"""

from __future__ import annotations
from typing import Optional, List, Dict, Union, Any, Literal, ClassVar
from datetime import datetime, date
from decimal import Decimal
from pathlib import Path
from uuid import UUID
from enum import Enum

try:
    from pydantic import BaseModel, Field, validator, root_validator, ConfigDict
    from pydantic.types import EmailStr, HttpUrl, SecretStr, PositiveInt, ConstrainedStr
    PYDANTIC_V2 = hasattr(BaseModel, 'model_config')
except ImportError:
    # Fallback definitions for testing without pydantic
    class BaseModel:
        pass
    
    def Field(**kwargs): return None
    def validator(*args, **kwargs): return lambda f: f
    def root_validator(*args, **kwargs): return lambda f: f
    
    EmailStr = str
    HttpUrl = str
    SecretStr = str
    PositiveInt = int
    ConstrainedStr = str
    ConfigDict = dict
    PYDANTIC_V2 = False


class StatusEnum(Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class PriorityEnum(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3


# Basic Pydantic model
class User(BaseModel):
    """User model with basic field types."""
    id: int
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    is_active: bool = True
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    if PYDANTIC_V2:
        model_config = ConfigDict(from_attributes=True)
    else:
        class Config:
            from_attributes = True


# Model with field constraints
class Product(BaseModel):
    """Product model with field validation and constraints."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    price: Decimal = Field(..., gt=0, decimal_places=2)
    quantity: PositiveInt = Field(default=0)
    category: str = Field(..., regex=r'^[a-zA-Z][a-zA-Z0-9_-]*$')
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    
    @validator('tags')
    def validate_tags(cls, v):
        """Validate that tags are unique and lowercase."""
        return list(set(tag.lower() for tag in v))
    
    @validator('price')
    def validate_price(cls, v):
        """Validate price is reasonable."""
        if v > 1000000:
            raise ValueError('Price cannot exceed 1,000,000')
        return v


# Model with computed fields and properties
class Article(BaseModel):
    """Article model with computed fields and custom validation."""
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=10)
    author_id: int
    status: StatusEnum = StatusEnum.DRAFT
    priority: PriorityEnum = PriorityEnum.MEDIUM
    published_at: Optional[datetime] = None
    view_count: int = 0
    tags: List[str] = Field(default_factory=list)
    
    @property
    def is_published(self) -> bool:
        """Check if article is published."""
        return self.status == StatusEnum.PUBLISHED and self.published_at is not None
    
    @property
    def word_count(self) -> int:
        """Calculate word count of content."""
        return len(self.content.split())
    
    @root_validator
    def validate_published_article(cls, values):
        """Validate published articles have required fields."""
        status = values.get('status')
        published_at = values.get('published_at')
        
        if status == StatusEnum.PUBLISHED and not published_at:
            values['published_at'] = datetime.now()
        
        return values


# Nested models
class Address(BaseModel):
    """Address model for nested validation."""
    street: str = Field(..., min_length=1)
    city: str = Field(..., min_length=1)
    state: str = Field(..., min_length=2, max_length=2)
    zip_code: str = Field(..., regex=r'^\d{5}(-\d{4})?$')
    country: str = "US"


class Company(BaseModel):
    """Company model with nested address."""
    name: str = Field(..., min_length=1, max_length=100)
    website: Optional[HttpUrl] = None
    address: Address
    employees: List[User] = Field(default_factory=list)
    founded_year: int = Field(..., ge=1800, le=2024)
    
    @validator('founded_year')
    def validate_founded_year(cls, v):
        """Validate founded year is not in the future."""
        current_year = datetime.now().year
        if v > current_year:
            raise ValueError(f'Founded year cannot be in the future (current: {current_year})')
        return v


# Model with secret fields
class AuthCredentials(BaseModel):
    """Authentication credentials with secret fields."""
    username: str = Field(..., min_length=3, max_length=50)
    password: SecretStr = Field(..., min_length=8)
    api_key: Optional[SecretStr] = None
    two_factor_enabled: bool = False
    
    if PYDANTIC_V2:
        model_config = ConfigDict(
            json_encoders={SecretStr: lambda v: v.get_secret_value() if v else None}
        )
    else:
        class Config:
            json_encoders = {
                SecretStr: lambda v: v.get_secret_value() if v else None
            }


# Generic model
from typing import TypeVar, Generic
T = TypeVar('T')

class ApiResponse(BaseModel, Generic[T]):
    """Generic API response model."""
    success: bool
    message: str
    data: Optional[T] = None
    timestamp: datetime = Field(default_factory=datetime.now)
    
    if not PYDANTIC_V2:
        class Config:
            arbitrary_types_allowed = True


# Model with custom field types
class FileInfo(BaseModel):
    """File information model with custom types."""
    name: str = Field(..., min_length=1)
    path: Path
    size_bytes: int = Field(..., ge=0)
    mime_type: str
    checksum: str = Field(..., regex=r'^[a-fA-F0-9]{64}$')  # SHA256
    created_at: datetime
    modified_at: datetime
    owner_id: UUID
    
    @validator('path')
    def validate_path_exists(cls, v):
        """Validate that the path exists (in real implementation)."""
        # In a real implementation, you might check if the path exists
        return v
    
    @property
    def size_mb(self) -> float:
        """File size in megabytes."""
        return round(self.size_bytes / (1024 * 1024), 2)


# Model with literal types and unions
class DatabaseConfig(BaseModel):
    """Database configuration with literal types."""
    driver: Literal["postgresql", "mysql", "sqlite"] = "postgresql"
    host: str = "localhost"
    port: int = Field(default=5432, ge=1, le=65535)
    database: str
    username: str
    password: SecretStr
    ssl_mode: Literal["require", "prefer", "disable"] = "prefer"
    connection_timeout: int = Field(default=30, ge=1, le=300)
    max_connections: int = Field(default=20, ge=1, le=100)
    
    @root_validator
    def validate_port_for_driver(cls, values):
        """Set default port based on database driver."""
        driver = values.get('driver')
        port = values.get('port')
        
        # Set default ports if not explicitly provided
        if port == 5432:  # Default value
            if driver == 'mysql':
                values['port'] = 3306
            elif driver == 'sqlite':
                values['port'] = 0  # SQLite doesn't use ports
        
        return values


# Model with custom validators and transformers
class PersonProfile(BaseModel):
    """Person profile with advanced validation."""
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    email: EmailStr
    phone: Optional[str] = Field(None, regex=r'^\+?1?\d{9,15}$')
    birth_date: date
    bio: Optional[str] = Field(None, max_length=1000)
    interests: List[str] = Field(default_factory=list, max_items=10)
    social_links: Dict[str, HttpUrl] = Field(default_factory=dict)
    
    @property
    def full_name(self) -> str:
        """Get full name."""
        return f"{self.first_name} {self.last_name}"
    
    @property
    def age(self) -> int:
        """Calculate age from birth date."""
        today = date.today()
        return today.year - self.birth_date.year - (
            (today.month, today.day) < (self.birth_date.month, self.birth_date.day)
        )
    
    @validator('birth_date')
    def validate_birth_date(cls, v):
        """Validate birth date is not in the future and person is not too old."""
        today = date.today()
        if v > today:
            raise ValueError('Birth date cannot be in the future')
        
        age = today.year - v.year
        if age > 150:
            raise ValueError('Age cannot exceed 150 years')
        
        return v
    
    @validator('interests')
    def validate_interests(cls, v):
        """Validate and normalize interests."""
        # Remove duplicates and normalize case
        normalized = []
        seen = set()
        for interest in v:
            normalized_interest = interest.strip().lower()
            if normalized_interest and normalized_interest not in seen:
                normalized.append(interest.strip())
                seen.add(normalized_interest)
        return normalized


# Model inheritance
class BaseEntity(BaseModel):
    """Base entity with common fields."""
    id: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None
    is_active: bool = True
    
    if PYDANTIC_V2:
        model_config = ConfigDict(from_attributes=True)
    else:
        class Config:
            from_attributes = True


class BlogPost(BaseEntity):
    """Blog post model extending base entity."""
    title: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., regex=r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
    content: str = Field(..., min_length=10)
    author: User
    category: str
    tags: List[str] = Field(default_factory=list)
    is_featured: bool = False
    published_at: Optional[datetime] = None
    
    @validator('slug', pre=True)
    def generate_slug(cls, v, values):
        """Generate slug from title if not provided."""
        if not v and 'title' in values:
            import re
            title = values['title']
            slug = re.sub(r'[^\w\s-]', '', title.lower())
            slug = re.sub(r'[\s_-]+', '-', slug)
            return slug.strip('-')
        return v


# Module constants and helper functions
DEFAULT_USER_SETTINGS: Dict[str, Any] = {
    'theme': 'light',
    'language': 'en',
    'notifications': True,
    'privacy_level': 'public'
}

def create_test_user(username: str, email: str) -> User:
    """Create a test user with default values."""
    return User(
        id=1,
        username=username,
        email=email,
        created_at=datetime.now(),
        is_active=True
    )

def validate_model_data(model_class: type, data: Dict[str, Any]) -> bool:
    """Validate data against a model class."""
    try:
        model_class(**data)
        return True
    except Exception:
        return False


# Export for testing
__all__ = [
    'StatusEnum', 'PriorityEnum', 'User', 'Product', 'Article', 'Address',
    'Company', 'AuthCredentials', 'ApiResponse', 'FileInfo', 'DatabaseConfig',
    'PersonProfile', 'BaseEntity', 'BlogPost', 'DEFAULT_USER_SETTINGS',
    'create_test_user', 'validate_model_data'
]