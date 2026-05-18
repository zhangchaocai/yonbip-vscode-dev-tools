"""
开放平台 access_token 获取与缓存
导出自公共 iuap_common.bip_auth 模块
"""
from __future__ import annotations

# 从共享库重新导出所有公共API，保持向后兼容
from iuap_common.bip_auth import (
    TOKEN_SUCCESS_CODE,
    clear_all_token_caches,
    get_access_token,
    http_get_json,
    http_post_json,
    invalidate_token_cache,
)

__all__ = [
    "TOKEN_SUCCESS_CODE",
    "clear_all_token_caches",
    "get_access_token",
    "http_get_json",
    "http_post_json",
    "invalidate_token_cache",
]
