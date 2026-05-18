#!/usr/bin/env python3
"""
业务接口查询（增强版）

Features:
    - 通用 HTTP 请求抽象（消除重复代码）
    - 并行查询支持
    - 响应缓存（减少重复查询）
    - 限流保护
    - 分页支持
    - 更完善的错误处理

"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

# 添加 iuap_common 目录到 sys.path，导入共享模块
# 路径: scripts/business_interface_query.py → scripts/ → iuap_common/
_script_dir = Path(__file__).resolve().parent
_common_dir = _script_dir / "iuap_common"
if str(_common_dir) not in sys.path:
    sys.path.insert(0, str(_common_dir))

import requests

from iuap_common.bip_auth import (
    get_access_token,
    invalidate_token_cache,
    _should_retry_with_new_token,
)
from iuap_common.console_utf8 import configure_stdio_utf8
from iuap_common.python_version_check import require_python_version
from iuap_common.retry_utils import retry_on_failure, RateLimiter
from iuap_common.utils import ExitCode, load_dotenv, resolve_config

logger = logging.getLogger(__name__)


# =============================================================================
# 配置加载
# =============================================================================

def _skill_dir() -> Path:
    # scripts/business_interface_query.py → scripts/ → skill root
    return Path(__file__).resolve().parent.parent


# =============================================================================
# 数据结构
# =============================================================================

@dataclass
class QueryResult:
    """查询结果封装"""
    success: bool
    description: str
    text: str
    api_id: Optional[str] = None
    api_name: Optional[str] = None
    error: Optional[str] = None
    duration_ms: float = 0.0


@dataclass
class QueryOptions:
    """查询选项"""
    max_workers: int = 3  # 并行查询线程数
    use_cache: bool = True  # 是否启用缓存
    cache_ttl_seconds: float = 300.0  # 缓存 TTL
    page_size: int = 20  # 分页大小
    include_raw: bool = False  # 是否包含原始响应


# =============================================================================
# 缓存实现
# =============================================================================

class ResponseCache:
    """简单的内存缓存"""

    def __init__(self, ttl_seconds: float = 300.0):
        self._cache: Dict[str, tuple[Any, float]] = {}
        self._ttl = ttl_seconds
        self._lock = threading.Lock()

    def _key(self, endpoint: str, params: Dict[str, Any]) -> str:
        """生成缓存键"""
        raw = json.dumps({"endpoint": endpoint, "params": params}, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(raw.encode()).hexdigest()

    def get(self, endpoint: str, params: Dict[str, Any]) -> Optional[Any]:
        key = self._key(endpoint, params)
        with self._lock:
            if key in self._cache:
                data, expires_at = self._cache[key]
                if time.time() < expires_at:
                    logger.debug("缓存命中: %s", endpoint)
                    return data
                else:
                    del self._cache[key]
        return None

    def set(self, endpoint: str, params: Dict[str, Any], data: Any) -> None:
        key = self._key(endpoint, params)
        with self._lock:
            self._cache[key] = (data, time.time() + self._ttl)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


# 全局缓存实例
_global_cache: ResponseCache = ResponseCache()


# =============================================================================
# HTTP 请求抽象
# =============================================================================

def _normalize_api_path(path: str) -> str:
    """规范化 API 路径"""
    p = (path or "").strip()
    return p if p.startswith("/") else f"/{p}"


def _api_timeout_verify(cfg: dict) -> tuple[int, bool]:
    """获取超时和 TLS 配置"""
    api = cfg.get("api") or {}
    return int(api.get("http_timeout_seconds", 120)), not bool(api.get("insecure_tls"))


@dataclass
class HttpRequest:
    """HTTP 请求配置"""
    method: str  # GET, POST
    path: str
    body: Optional[Dict[str, Any]] = None
    query_params: Optional[Dict[str, str]] = None


@dataclass
class HttpResponse:
    """HTTP 响应封装"""
    status_code: int
    headers: Dict[str, str]
    body: Any
    raw_body: Any  # 原始响应


def _execute_http_request(
    cfg: dict,
    request: HttpRequest,
    *,
    use_cache: bool = True,
    _retry: bool = True,
) -> HttpResponse:
    """
    通用 HTTP 请求执行器。

    支持:
        - GET/POST
        - Token 自动注入
        - 缓存
        - 自动重试
    """
    api = cfg.get("api") or {}
    base = (api.get("base_url") or "").strip().rstrip("/")
    path = _normalize_api_path(request.path)
    url = f"{base}{path}"
    timeout, verify = _api_timeout_verify(cfg)

    # 获取 token
    token = get_access_token(cfg)
    params = {"access_token": token}
    if request.query_params:
        params.update(request.query_params)

    # 尝试从缓存读取
    cache_key_data = {"url": url, "params": params, "body": request.body}
    if use_cache and request.method == "GET":
        cached = _global_cache.get(request.path, cache_key_data)
        if cached is not None:
            return HttpResponse(
                status_code=200,
                headers={},
                body=cached,
                raw_body=cached
            )

    # 发送请求
    if request.method.upper() == "POST":
        r = requests.post(url, params=params, json=request.body, timeout=timeout, verify=verify)
    else:
        r = requests.get(url, params=params, timeout=timeout, verify=verify)

    # 解析响应
    try:
        payload = r.json()
    except ValueError:
        payload = None

    # Token 失效重试
    if _retry and _should_retry_with_new_token(cfg, r.status_code, payload):
        logger.warning("请求 Token 失效，刷新后重试")
        invalidate_token_cache(cfg)
        get_access_token(cfg, force_refresh=True)
        return _execute_http_request(cfg, request, use_cache=False, _retry=False)

    r.raise_for_status()

    if payload is None:
        try:
            payload = json.loads(r.content.decode("utf-8"))
        except ValueError as e:
            snippet = (r.content.decode("utf-8", errors="replace") or "")[:500]
            raise RuntimeError(f"响应非 JSON: {snippet}") from e

    # 写入缓存
    if use_cache and request.method == "GET":
        _global_cache.set(request.path, cache_key_data, payload)

    return HttpResponse(
        status_code=r.status_code,
        headers=dict(r.headers),
        body=payload,
        raw_body=payload
    )


# =============================================================================
# 业务接口查询
# =============================================================================

def _code_ok(node: dict, expected: str) -> bool:
    """检查响应码是否匹配"""
    c = node.get("code")
    return str(c).strip() == str(expected).strip()


def build_input_param_node(param: dict) -> dict:
    """构建入参节点（含递归子参数）"""
    node: Dict[str, Any] = {
        "参数名": param.get("name") or "",
        "参数描述": param.get("paramDesc") or "",
        "参数类型": param.get("paramType") or "",
        "请求参数类型": param.get("requestParamType") or "",
    }
    children = param.get("children")
    if isinstance(children, list) and children:
        node["子参数"] = [
            build_input_param_node(c)
            for c in children
            if isinstance(c, dict)
        ]
    return node


def build_field_node(field: dict) -> dict:
    """构建出参字段节点"""
    node: Dict[str, Any] = {
        "描述": field.get("paramDesc") or "",
        "类型": field.get("paramType") or "",
    }
    children = field.get("children")
    if isinstance(children, list) and children:
        children_node: Dict[str, Any] = {}
        for child in children:
            if not isinstance(child, dict):
                continue
            cn = child.get("name") or ""
            if cn:
                children_node[cn] = build_field_node(child)
        if children_node:
            node["子字段"] = children_node
    return node


def split_interface_input_hints(text: str) -> List[str]:
    """将话术中的入参关注点拆成关键词列表"""
    if not text or not str(text).strip():
        return []
    raw = str(text).replace("，", ",").replace("、", ",")
    return [p.strip() for p in raw.split(",") if p.strip()]


def _param_row_matches_hint(name: str, desc: str, hint: str) -> bool:
    """判断参数行是否匹配提示词"""
    h = hint.strip()
    if not h:
        return False
    n, d = name or "", desc or ""

    # 精确包含匹配
    if h in n or h in d:
        return True

    # 大小写不敏感匹配
    hl, nl = h.lower(), n.lower()
    if hl and (hl in nl or hl in (d or "").lower()):
        return True

    return False


def collect_matching_input_params(
    params: List[dict], hints: List[str], path_prefix: str = ""
) -> List[Dict[str, Any]]:
    """收集所有匹配的入参（含递归）"""
    rows: List[Dict[str, Any]] = []
    for p in params:
        if not isinstance(p, dict):
            continue
        pname = str(p.get("参数名") or "")
        pdesc = str(p.get("参数描述") or "")
        full_path = f"{path_prefix}.{pname}" if path_prefix else pname

        for h in hints:
            if _param_row_matches_hint(pname, pdesc, h):
                rows.append({
                    "匹配关键词": h,
                    "参数路径": full_path or pname,
                    "参数名": pname,
                    "参数描述": pdesc,
                    "参数类型": p.get("参数类型") or "",
                    "请求参数类型": p.get("请求参数类型") or "",
                })
                break

        # 递归处理子参数
        children = p.get("子参数")
        if isinstance(children, list) and children:
            rows.extend(collect_matching_input_params(children, hints, full_path or pname))

    return rows


def build_ai_friendly_structure(detail_data: dict) -> dict:
    """构建 AI 友好的响应结构"""
    result: Dict[str, Any] = {
        "接口地址": detail_data.get("completeProxyUrl") or "",
        "请求协议": detail_data.get("requestProtocol") or "HTTP",
        "请求方式": detail_data.get("serviceHttpMethod") or "POST",
    }

    # 入参列表
    input_params: List[dict] = []
    pdtos = detail_data.get("paramDTOS")
    if isinstance(pdtos, list):
        for p in pdtos:
            if isinstance(p, dict):
                input_params.append(build_input_param_node(p))
    result["入参列表"] = input_params

    # 出参结构
    out_struct: Dict[str, Any] = {}
    prdtos = detail_data.get("paramReturnDTOS")
    if isinstance(prdtos, list):
        for rp in prdtos:
            if not isinstance(rp, dict):
                continue
            name = rp.get("name") or ""
            if name:
                out_struct[name] = build_field_node(rp)
    result["出参结构"] = out_struct

    # 代码生成提示
    result["代码生成提示"] = _generate_code_hint(result)

    return result


def _generate_code_hint(structure: dict) -> str:
    """生成代码调用提示"""
    method = structure.get("请求方式") or "POST"
    url = structure.get("接口地址") or ""
    return (
        "基于以上接口信息，你可以：\n"
        "1. 使用OpenAPI调用方式：参考 getOpenApiCall 工具获取完整的OpenAPI调用流程\n"
        "2. 使用RestProxy前端调用：参考 getRestProxyGuide 工具获取前端REST调用指南\n"
        f"3. 后端HTTP调用：使用HttpClient或RestTemplate发送{method}请求到{url}"
    )


def enrich_with_input_hints(friendly: dict, hints: List[str]) -> dict:
    """在 AI 友好结构中附加入参关注点匹配结果"""
    if not hints:
        return friendly

    out = dict(friendly)
    out["用户话术中的入参关注点"] = hints

    inputs = out.get("入参列表")
    if isinstance(inputs, list):
        matched = collect_matching_input_params(inputs, hints)
        out["与关注点匹配的入参"] = matched
        if not matched:
            out["与关注点匹配的入参说明"] = (
                "未在接口入参名/描述中找到与上述关注点直接匹配项，请以完整「入参列表」为准或调整关键词。"
            )
    else:
        out["与关注点匹配的入参"] = []
        out["与关注点匹配的入参说明"] = "接口详情中无入参列表结构，请查看原始返回。"

    return out


def _is_failed_block(block: str) -> bool:
    """判断输出块是否为失败信息"""
    prefixes = (
        "错误",
        "查询失败",
        "未找到",
        "查询接口列表失败",
        "查询接口详情失败",
    )
    return any(block.startswith(p) for p in prefixes)


@retry_on_failure(max_attempts=3, delay=0.5, backoff=2.0)
def query_single(
    cfg: dict,
    interface_desc: str,
    *,
    interface_input_hints: Optional[str] = None,
    options: Optional[QueryOptions] = None,
) -> QueryResult:
    """
    执行单个接口查询。

    Args:
        cfg: 配置字典
        interface_desc: 接口描述
        interface_input_hints: 入参关注点
        options: 查询选项

    Returns:
        QueryResult 查询结果
    """
    opts = options or QueryOptions()
    start_time = time.time()

    bi = cfg.get("business_interface") or {}
    list_ok = str(bi.get("list_success_code", "200"))
    detail_ok = str(bi.get("detail_success_code", "200"))
    idx = int(bi.get("match_index", 0))

    # 1. 查询列表
    try:
        list_resp = _execute_http_request(
            cfg,
            HttpRequest(
                method="POST",
                path=bi.get("list_path", ""),
                body={bi.get("list_body_param_name", "param"): interface_desc},
            ),
            use_cache=opts.use_cache,
        )
    except Exception as e:
        return QueryResult(
            success=False,
            description=interface_desc,
            text=f"查询失败: {e}",
            error=str(e),
            duration_ms=(time.time() - start_time) * 1000,
        )

    list_node = list_resp.body
    if not _code_ok(list_node, list_ok):
        msg = list_node.get("message") or list_node.get("msg") or "未知错误"
        return QueryResult(
            success=False,
            description=interface_desc,
            text=f"查询接口列表失败: {msg}",
            error=msg,
            duration_ms=(time.time() - start_time) * 1000,
        )

    # 2. 解析列表响应
    data_node = list_node.get("data")
    if not isinstance(data_node, list) or len(data_node) == 0:
        return QueryResult(
            success=False,
            description=interface_desc,
            text="未找到匹配的业务接口，请尝试其他描述",
            error="无匹配结果",
            duration_ms=(time.time() - start_time) * 1000,
        )

    # 支持分页：取所有匹配的接口
    if opts.page_size > 0 and len(data_node) > opts.page_size:
        data_node = data_node[:opts.page_size]

    # 3. 检查索引边界
    if idx < 0 or idx >= len(data_node):
        return QueryResult(
            success=False,
            description=interface_desc,
            text=f"匹配索引 match_index={idx} 超出列表长度 {len(data_node)}",
            error="索引越界",
            duration_ms=(time.time() - start_time) * 1000,
        )

    first = data_node[idx]
    if not isinstance(first, dict):
        return QueryResult(
            success=False,
            description=interface_desc,
            text="查询失败: 列表项格式异常",
            error="格式异常",
            duration_ms=(time.time() - start_time) * 1000,
        )

    api_id = first.get("apiId")
    if not api_id:
        return QueryResult(
            success=False,
            description=interface_desc,
            text="查询失败: 列表未返回 apiId",
            error="缺少 apiId",
            duration_ms=(time.time() - start_time) * 1000,
        )

    api_name = first.get("apiName") or ""
    category = first.get("category") or ""

    # 4. 查询详情
    try:
        detail_path = bi.get("detail_path", "").replace("{apiId}", str(api_id))
        detail_resp = _execute_http_request(
            cfg,
            HttpRequest(method="GET", path=detail_path),
            use_cache=opts.use_cache,
        )
    except Exception as e:
        return QueryResult(
            success=False,
            description=interface_desc,
            text=f"查询失败: {e}",
            error=str(e),
            duration_ms=(time.time() - start_time) * 1000,
        )

    detail_node = detail_resp.body
    if not _code_ok(detail_node, detail_ok):
        msg = detail_node.get("message") or detail_node.get("msg") or "未知错误"
        return QueryResult(
            success=False,
            description=interface_desc,
            text=f"查询接口详情失败: {msg}",
            error=msg,
            duration_ms=(time.time() - start_time) * 1000,
        )

    detail_data = detail_node.get("data")
    if not isinstance(detail_data, dict):
        return QueryResult(
            success=False,
            description=interface_desc,
            text="查询失败: 详情 data 非对象",
            error="详情格式异常",
            duration_ms=(time.time() - start_time) * 1000,
        )

    # 5. 构建输出
    friendly = build_ai_friendly_structure(detail_data)
    hints = split_interface_input_hints(interface_input_hints or "")
    if hints:
        friendly = enrich_with_input_hints(friendly, hints)

    # 6. 格式化输出
    out_parts: List[str] = []
    out_parts.append("找到匹配接口:\n")
    out_parts.append(f"- 接口名称: {api_name}\n")
    out_parts.append(f"- 分类: {category}\n")

    if hints:
        out_parts.append("=== 从用户话术梳理的入参关注点 ===\n")
        for h in hints:
            out_parts.append(f"- {h}\n")
        out_parts.append("\n")

        matched = friendly.get("与关注点匹配的入参")
        if isinstance(matched, list) and matched:
            out_parts.append("=== 与上述关注点匹配的接口入参（元数据）===\n")
            out_parts.append(json.dumps(matched, ensure_ascii=False, indent=2))
            out_parts.append("\n\n")
        else:
            note = friendly.get("与关注点匹配的入参说明")
            if note:
                out_parts.append(f"{note}\n\n")

    out_parts.append("=== 接口详细信息（AI友好格式）===\n\n")
    out_parts.append(json.dumps(friendly, ensure_ascii=False, indent=2))

    return QueryResult(
        success=True,
        description=interface_desc,
        text="".join(out_parts),
        api_id=str(api_id),
        api_name=api_name,
        duration_ms=(time.time() - start_time) * 1000,
    )


def query_multiple_parallel(
    cfg: dict,
    descriptions: List[str],
    hints: Optional[str] = None,
    options: Optional[QueryOptions] = None,
) -> List[QueryResult]:
    """
    并行执行多个接口查询。

    Args:
        cfg: 配置字典
        descriptions: 接口描述列表
        hints: 入参关注点（共享）
        options: 查询选项

    Returns:
        按输入顺序排列的查询结果列表
    """
    opts = options or QueryOptions()
    results: List[Optional[QueryResult]] = [None] * len(descriptions)

    with ThreadPoolExecutor(max_workers=opts.max_workers) as executor:
        futures = {
            executor.submit(
                query_single, cfg, desc,
                interface_input_hints=hints,
                options=opts
            ): i
            for i, desc in enumerate(descriptions)
        }

        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                results[idx] = QueryResult(
                    success=False,
                    description=descriptions[idx],
                    text=f"查询失败: {e}",
                    error=str(e),
                )

    return [r for r in results if r is not None]


def format_results(results: List[QueryResult]) -> str:
    """格式化多个查询结果为文本输出"""
    chunks: List[str] = []
    success_count = sum(1 for r in results if r.success)

    for i, result in enumerate(results):
        if i > 0:
            chunks.append(
                "\n\n========================================\n========================================\n\n"
            )
        chunks.append(f"【查询描述 {i + 1}/{len(results)}】: {result.description}\n\n")
        chunks.append(result.text)

    chunks.append("\n\n========================================\n")
    chunks.append(f"查询完成: 共 {len(results)} 个描述，成功 {success_count} 个")

    return "".join(chunks)


# =============================================================================
# 主入口
# =============================================================================

def main() -> int:
    require_python_version()

    configure_stdio_utf8()

    ap = argparse.ArgumentParser(description="业务接口查询（对齐 BusinessInterfaceQueryTool）")
    ap.add_argument("--config", default=str(_skill_dir() / "config.yaml"))
    ap.add_argument(
        "--all-interface-desc",
        dest="all_interface_desc",
        default="",
        help="接口描述，多个英文逗号分隔",
    )
    ap.add_argument(
        "--interface-input-hints",
        dest="interface_input_hints",
        default="",
        help="从用户话术抽取的入参关注点，逗号/顿号分隔",
    )
    ap.add_argument(
        "--parallel",
        dest="parallel",
        action="store_true",
        help="启用并行查询",
    )
    ap.add_argument(
        "--max-workers",
        dest="max_workers",
        type=int,
        default=3,
        help="并行查询的最大线程数",
    )
    ap.add_argument(
        "--no-cache",
        dest="no_cache",
        action="store_true",
        help="禁用响应缓存",
    )
    ap.add_argument(
        "--clear-cache",
        dest="clear_cache",
        action="store_true",
        help="清除缓存后退出",
    )
    ap.add_argument(
        "--env-file",
        default=None,
        help="显式指定 .env 路径（默认会加载与 config 同目录下的 .env，与 iuap-c-metadata-info 一致）",
    )

    args = ap.parse_args()

    # 可选：先加载用户指定的 .env；随后 resolve_config 会再加载 config.yaml 同目录下 .env（若存在则合并）
    if args.env_file:
        env_path = Path(args.env_file).expanduser().resolve()
        load_dotenv(env_path)

    cfg_path = Path(args.config).expanduser().resolve()
    if not cfg_path.exists():
        print(f"错误: 配置文件不存在: {cfg_path}", file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    try:
        cfg = resolve_config(cfg_path)
    except Exception as e:
        print(f"错误: 配置加载失败: {e}", file=sys.stderr)
        return ExitCode.CONFIG_ERROR

    # 清除缓存
    if args.clear_cache:
        _global_cache.clear()
        print("缓存已清除", file=sys.stderr)
        return ExitCode.SUCCESS

    # 解析描述
    desc = (args.all_interface_desc or "").strip()
    if not desc:
        desc = str((cfg.get("request") or {}).get("allInterfaceDesc", "")).strip()

    if not desc:
        print(
            "错误：请提供业务接口描述信息（--all-interface-desc 或 config.request.allInterfaceDesc）",
            file=sys.stderr,
        )
        return ExitCode.VALIDATION_ERROR

    hints_raw = (args.interface_input_hints or "").strip()
    if not hints_raw:
        hints_raw = str((cfg.get("request") or {}).get("interface_input_hints", "")).strip()

    parts = [p.strip() for p in desc.split(",") if p.strip()]

    # 构建选项
    options = QueryOptions(
        max_workers=args.max_workers if args.parallel else 1,
        use_cache=not args.no_cache,
    )

    # 执行查询
    if args.parallel and len(parts) > 1:
        results = query_multiple_parallel(cfg, parts, hints_raw, options)
    else:
        results = [query_single(cfg, p, interface_input_hints=hints_raw, options=options) for p in parts]

    # 输出
    text = format_results(results)
    print(text)

    # 写入文件
    out_cfg = cfg.get("output") or {}
    if out_cfg.get("write_result_json", False):
        out_dir = _skill_dir() / (cfg.get("paths") or {}).get("output_dir", "output")
        out_dir.mkdir(parents=True, exist_ok=True)
        fn = out_cfg.get("result_json_filename", "business_interface_last.json")

        payload = {
            "text_result": text,
            "descriptions": parts,
            "interface_input_hints": split_interface_input_hints(hints_raw),
            "success_count": sum(1 for r in results if r.success),
            "results": [
                {
                    "description": r.description,
                    "success": r.success,
                    "api_id": r.api_id,
                    "api_name": r.api_name,
                    "error": r.error,
                    "duration_ms": round(r.duration_ms, 2),
                }
                for r in results
            ],
        }

        (out_dir / fn).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    return ExitCode.SUCCESS


if __name__ == "__main__":
    raise SystemExit(main())
