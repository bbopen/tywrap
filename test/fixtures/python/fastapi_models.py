"""
FastAPI models and endpoints test fixture.
Tests FastAPI-specific patterns, dependency injection, and API structures.
"""

from __future__ import annotations
from typing import Optional, List, Dict, Union, Any, Annotated
from datetime import datetime
from enum import Enum

try:
    from fastapi import FastAPI, APIRouter, Depends, HTTPException, Path, Query, Body, Header
    from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
    from pydantic import BaseModel, Field
    FASTAPI_AVAILABLE = True
except ImportError:
    # Fallback definitions for testing without FastAPI
    class FastAPI: pass
    class APIRouter: pass
    class HTTPException: pass
    def Depends(dependency): return dependency
    def Path(**kwargs): return None
    def Query(**kwargs): return None  
    def Body(**kwargs): return None
    def Header(**kwargs): return None
    
    class BaseModel: pass
    def Field(**kwargs): return None
    
    class HTTPBearer: pass
    class HTTPAuthorizationCredentials: pass
    
    FASTAPI_AVAILABLE = False


# Enums for API
class UserRole(str, Enum):
    ADMIN = "admin"
    USER = "user"
    MODERATOR = "moderator"


class PostStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


# Request/Response models
class UserCreate(BaseModel):
    """User creation request model."""
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., regex=r'^[\w\.-]+@[\w\.-]+\.\w+$')
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = Field(None, max_length=100)
    role: UserRole = UserRole.USER


class UserResponse(BaseModel):
    """User response model."""
    id: int
    username: str
    email: str
    full_name: Optional[str] = None
    role: UserRole
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None
    
    if FASTAPI_AVAILABLE:
        class Config:
            from_attributes = True


class UserUpdate(BaseModel):
    """User update request model."""
    email: Optional[str] = Field(None, regex=r'^[\w\.-]+@[\w\.-]+\.\w+$')
    full_name: Optional[str] = Field(None, max_length=100)
    is_active: Optional[bool] = None


class PostCreate(BaseModel):
    """Post creation request model."""
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=10)
    tags: List[str] = Field(default_factory=list, max_items=10)
    is_featured: bool = False
    published_at: Optional[datetime] = None


class PostResponse(BaseModel):
    """Post response model."""
    id: int
    title: str
    content: str
    author: UserResponse
    status: PostStatus
    tags: List[str]
    is_featured: bool
    created_at: datetime
    published_at: Optional[datetime] = None
    view_count: int = 0
    
    if FASTAPI_AVAILABLE:
        class Config:
            from_attributes = True


class PostUpdate(BaseModel):
    """Post update request model."""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, min_length=10)
    tags: Optional[List[str]] = Field(None, max_items=10)
    is_featured: Optional[bool] = None
    status: Optional[PostStatus] = None


# Pagination models
class PaginationParams(BaseModel):
    """Pagination parameters."""
    page: int = Field(default=1, ge=1)
    size: int = Field(default=20, ge=1, le=100)
    
    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


class PaginatedResponse(BaseModel):
    """Paginated response wrapper."""
    items: List[Any]
    total: int
    page: int
    size: int
    pages: int
    
    @property
    def has_next(self) -> bool:
        return self.page < self.pages
    
    @property
    def has_prev(self) -> bool:
        return self.page > 1


# Error response models
class ErrorResponse(BaseModel):
    """Standard error response model."""
    error: str
    message: str
    details: Optional[Dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=datetime.now)


class ValidationErrorResponse(BaseModel):
    """Validation error response model."""
    error: str = "validation_error"
    message: str
    field_errors: List[Dict[str, str]]


# Authentication models
class LoginRequest(BaseModel):
    """Login request model."""
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    """Token response model."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: Optional[str] = None


# Dependency functions (would normally be in separate module)
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer())
) -> UserResponse:
    """Extract current user from authentication token."""
    # In real implementation, would validate token and return user
    return UserResponse(
        id=1,
        username="testuser",
        email="test@example.com",
        role=UserRole.USER,
        is_active=True,
        created_at=datetime.now()
    )


def get_admin_user(
    current_user: UserResponse = Depends(get_current_user)
) -> UserResponse:
    """Ensure current user has admin role."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def get_pagination_params(
    page: int = Query(default=1, ge=1, description="Page number"),
    size: int = Query(default=20, ge=1, le=100, description="Page size")
) -> PaginationParams:
    """Extract pagination parameters from query string."""
    return PaginationParams(page=page, size=size)


# API endpoint type hints
def create_user_endpoint(
    user_data: UserCreate,
    current_user: UserResponse = Depends(get_admin_user)
) -> UserResponse:
    """Create new user endpoint."""
    # Implementation would create user in database
    return UserResponse(
        id=2,
        username=user_data.username,
        email=user_data.email,
        full_name=user_data.full_name,
        role=user_data.role,
        is_active=True,
        created_at=datetime.now()
    )


def get_user_endpoint(
    user_id: Annotated[int, Path(description="User ID", ge=1)],
    current_user: UserResponse = Depends(get_current_user)
) -> UserResponse:
    """Get user by ID endpoint."""
    if user_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Implementation would fetch user from database
    return current_user


def update_user_endpoint(
    user_id: Annotated[int, Path(description="User ID", ge=1)],
    user_update: UserUpdate,
    current_user: UserResponse = Depends(get_current_user)
) -> UserResponse:
    """Update user endpoint."""
    if user_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Implementation would update user in database
    return current_user


def list_users_endpoint(
    pagination: PaginationParams = Depends(get_pagination_params),
    role_filter: Optional[UserRole] = Query(None, description="Filter by role"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    current_user: UserResponse = Depends(get_admin_user)
) -> PaginatedResponse:
    """List users with pagination and filtering."""
    # Implementation would query database with filters
    users = [current_user]  # Mock data
    
    return PaginatedResponse(
        items=users,
        total=1,
        page=pagination.page,
        size=pagination.size,
        pages=1
    )


def create_post_endpoint(
    post_data: PostCreate,
    current_user: UserResponse = Depends(get_current_user)
) -> PostResponse:
    """Create new post endpoint."""
    # Implementation would create post in database
    return PostResponse(
        id=1,
        title=post_data.title,
        content=post_data.content,
        author=current_user,
        status=PostStatus.DRAFT if not post_data.published_at else PostStatus.PUBLISHED,
        tags=post_data.tags,
        is_featured=post_data.is_featured,
        created_at=datetime.now(),
        published_at=post_data.published_at
    )


def get_posts_endpoint(
    pagination: PaginationParams = Depends(get_pagination_params),
    status_filter: Optional[PostStatus] = Query(None, description="Filter by status"),
    author_id: Optional[int] = Query(None, description="Filter by author ID", ge=1),
    tags: Optional[List[str]] = Query(None, description="Filter by tags"),
    search: Optional[str] = Query(None, description="Search in title and content")
) -> PaginatedResponse:
    """Get posts with filtering and pagination."""
    # Implementation would query database with filters
    mock_post = PostResponse(
        id=1,
        title="Test Post",
        content="This is test content",
        author=UserResponse(
            id=1, username="author", email="author@example.com",
            role=UserRole.USER, is_active=True, created_at=datetime.now()
        ),
        status=PostStatus.PUBLISHED,
        tags=["test"],
        is_featured=False,
        created_at=datetime.now(),
        published_at=datetime.now()
    )
    
    return PaginatedResponse(
        items=[mock_post],
        total=1,
        page=pagination.page,
        size=pagination.size,
        pages=1
    )


# File upload models
class FileUploadResponse(BaseModel):
    """File upload response model."""
    filename: str
    size: int
    content_type: str
    url: str
    uploaded_at: datetime = Field(default_factory=datetime.now)


def upload_file_endpoint(
    file_data: bytes = Body(..., media_type="application/octet-stream"),
    filename: str = Header(..., alias="X-Filename"),
    content_type: str = Header(..., alias="Content-Type"),
    current_user: UserResponse = Depends(get_current_user)
) -> FileUploadResponse:
    """File upload endpoint."""
    # Implementation would save file and return response
    return FileUploadResponse(
        filename=filename,
        size=len(file_data),
        content_type=content_type,
        url=f"/files/{filename}"
    )


# WebSocket models (conceptual)
class WebSocketMessage(BaseModel):
    """WebSocket message model."""
    type: str
    payload: Dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.now)
    user_id: Optional[int] = None


class ChatMessage(BaseModel):
    """Chat message model for WebSocket."""
    room_id: str
    message: str
    sender: UserResponse
    timestamp: datetime = Field(default_factory=datetime.now)


# Background task models
class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class BackgroundTaskResponse(BaseModel):
    """Background task response model."""
    task_id: str
    status: TaskStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


def start_background_task(
    task_type: str,
    parameters: Dict[str, Any],
    current_user: UserResponse = Depends(get_current_user)
) -> BackgroundTaskResponse:
    """Start background task endpoint."""
    import uuid
    task_id = str(uuid.uuid4())
    
    return BackgroundTaskResponse(
        task_id=task_id,
        status=TaskStatus.PENDING,
        created_at=datetime.now()
    )


# Health check and metrics
class HealthStatus(BaseModel):
    """Health check status model."""
    status: str
    timestamp: datetime = Field(default_factory=datetime.now)
    version: str
    database: bool
    redis: bool
    external_apis: Dict[str, bool]


class MetricsResponse(BaseModel):
    """API metrics response model."""
    total_requests: int
    active_users: int
    response_time_avg: float
    error_rate: float
    uptime_seconds: int


def health_check_endpoint() -> HealthStatus:
    """Health check endpoint."""
    return HealthStatus(
        status="healthy",
        version="1.0.0",
        database=True,
        redis=True,
        external_apis={"payment_service": True, "email_service": True}
    )


def metrics_endpoint(
    current_user: UserResponse = Depends(get_admin_user)
) -> MetricsResponse:
    """Get API metrics endpoint."""
    return MetricsResponse(
        total_requests=10000,
        active_users=150,
        response_time_avg=0.25,
        error_rate=0.01,
        uptime_seconds=86400
    )


# Export for testing
__all__ = [
    'UserRole', 'PostStatus', 'UserCreate', 'UserResponse', 'UserUpdate',
    'PostCreate', 'PostResponse', 'PostUpdate', 'PaginationParams',
    'PaginatedResponse', 'ErrorResponse', 'ValidationErrorResponse',
    'LoginRequest', 'TokenResponse', 'FileUploadResponse', 'WebSocketMessage',
    'ChatMessage', 'TaskStatus', 'BackgroundTaskResponse', 'HealthStatus',
    'MetricsResponse', 'get_current_user', 'get_admin_user', 'get_pagination_params'
]