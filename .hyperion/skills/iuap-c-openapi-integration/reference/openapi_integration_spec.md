# BIP标准API调用框架

> **⚠️ 强制规范：本框架统一使用 `RestTemplate` 作为HTTP客户端，禁止使用 `HttpURLConnection`、`OkHttp`、`Apache HttpClient` 等其他客户端。**

本技能提供一套标准化的BIP（用友BIP）OpenAPI调用规范，适用于任何需要与BIP平台交互的Java/Spring项目。

## 架构概述

```
┌─────────────────────────────────────────────────────────────────┐
│                      业务服务层                                  │
│              (Business Service - 业务调用方)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BIP API 调用框架                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │   鉴权模块   │    │  HTTP调用模块 │    │  响应解析模块 │          │
│  │AccessToken │    │OpenApiUtils │    │ JSON解析   │          │
│  │  Utils    │    │ (RestTemplate)│   │           │          │
│  └─────────────┘    └─────────────┘    └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BIP OpenAPI 平台                             │
│         (网关地址 + API URI + AccessToken)                       │
└─────────────────────────────────────────────────────────────────┘
```

## 禁止与正例对比

| 方式 | 状态 | 说明 |
|------|------|------|
| `RestTemplate` | ✅ 推荐 | Spring标准HTTP客户端，本框架强制使用 |
| `HttpURLConnection` | ❌ 禁止 | 旧代码方式，禁止在新代码中使用 |
| `OkHttp` | ❌ 禁止 | 非Spring标准，禁止使用 |
| `Apache HttpClient` | ❌ 禁止 | 非Spring标准，禁止使用 |

```java
// ✅ 正确：使用OpenApiUtils（内部封装RestTemplate）
@Autowired
private OpenApiUtils openApiUtils;

public JSONObject callApi(String jsonBody, String url) {
    String response = openApiUtils.postMethod(jsonBody, url);
    return JSON.parseObject(response);
}

// ❌ 错误：直接使用HttpURLConnection（旧代码）
public static String post(String requestUrl, String jsonBody) {
    HttpURLConnection connection = null;  // ❌ 禁止使用
    // ...
}
```

## 核心组件

### 1. 鉴权模块 - AccessTokenUtils

负责获取BIP平台的访问令牌。

```java
@Component
public class AccessTokenUtils {

    private static final String URL_TOKEN = "/open-auth/selfAppAuth/getAccessToken";
    
    /**
     * 获取AccessToken
     * @param openApiUrl 认证域名 (如: http://xxx/iuap-api-auth)
     * @param appKey 应用Key
     * @param appSecret 应用密钥
     * @return access_token字符串
     */
    public String getAccessToken(String openApiUrl, String appKey, String appSecret) throws Exception {
        Map<String, Object> params = new HashMap<>();
        params.put("appKey", appKey);
        params.put("timestamp", String.valueOf(System.currentTimeMillis()));
        params.put("signature", SignHelper.sign(params, appSecret));
        
        String requestUrl = openApiUrl + URL_TOKEN;
        JSONObject jsonObject = JSON.parseObject(HttpClient.get(requestUrl, params));
        
        if (jsonObject == null || jsonObject.getJSONObject("data") == null) {
            throw new RuntimeException("access token 获取失败!");
        }
        return jsonObject.getJSONObject("data").getString("access_token");
    }
}
```

**禁止在（application.yml）配置：**
```yaml
# BIP应用配置
bip:
  appKey: your_app_key
  appSecret: your_app_secret
  # 网关地址（可选，如已在代码中拼接则不需要）
  # gatewayHost: http://xxx/iuap-api-gateway
  # 认证地址（可选）
  # authHost: http://xxx/iuap-api-auth

# 域名配置
domain:
  url: http://your-domain
```
**必须使用YMS配置，同时采用@Value模式引用配置**


### 2. HTTP调用模块 - OpenApiUtils

提供标准化的GET/POST请求方法。

```java
@Component
public class OpenApiUtils {

    /**
     * GET请求 - 标准调用方式
     * @param params 请求参数
     * @param requestUrl 完整请求URL（包含query参数）
     * @return 响应Map
     */
    public static Map<String, Object> getMethod(Map<String, Object> params, String requestUrl) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        
        RestTemplate restTemplate = new RestTemplate();
        try {
            ResponseEntity<Map> responseEntity = restTemplate.exchange(
                requestUrl, 
                HttpMethod.GET, 
                new HttpEntity<>(params, headers), 
                Map.class
            );
            return responseEntity.getBody();
        } catch (Exception e) {
            throw new RuntimeException("BIP API调用失败: " + e.getMessage());
        }
    }

    /**
     * POST请求
     * @param param 请求体参数
     * @param requestUrl API路径（不含access_token）
     * @param accessToken 访问令牌
     * @return 响应字符串
     */
    public static String postMethod(Map<String, Object> param, String requestUrl, String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(param, headers);

        final String url = requestUrl + "?access_token=" + accessToken;
        RestTemplate restTemplate = new RestTemplate();
        restTemplate.getMessageConverters().set(1, new StringHttpMessageConverter(StandardCharsets.UTF_8));
        
        try {
            ResponseEntity<String> responseEntity = restTemplate.postForEntity(url, entity, String.class);
            return responseEntity.getBody();
        } catch (Exception e) {
            throw new RuntimeException("BIP API调用失败: " + e.getMessage());
        }
    }
}
```

### 3. URI常量定义 - BipOpenApiUriConst

统一管理所有BIP API的URI地址。

```java
public class BipOpenApiUriConst {
    
    /**
     * 网关和认证地址
     */
    public static final String OPEN_GATEWAY_HOST = "/iuap-api-gateway";
    public static final String OPEN_AUTH_HOST = "/iuap-api-auth";
    
    /**
     * 通用档案查询URI
     * 具体业务API URI由各模块自行定义
     * 例如：
     * - 客户档案: /yonbip/digitalModel/merchant/queryByPage
     * - 供应商档案: /yonbip/digitalModel/vendor/queryByPage
     * - 物料档案: /yonbip/digitalModel/product/queryByPage
     */
    
    /**
     * 通用详情查询URI模板
     */
    public static final String DETAIL_TEMPLATE = "/yonbip/{module}/{entity}/detail";
    
    /**
     * 通用保存URI模板
     */
    public static final String SAVE_TEMPLATE = "/yonbip/{module}/{entity}/save";
    
    /**
     * 通用审核URI模板
     */
    public static final String AUDIT_TEMPLATE = "/yonbip/{module}/{entity}/audit";
}
```

## 标准调用流程

### Step 1: 配置初始化

在Service基类中初始化网关地址：

```java
public abstract class BaseBipServiceImpl implements InitializingBean {

    protected String openGatewayHost;
    protected String openAuthHost;

    @Value("${domain.url}")
    protected String domainUrl;

    @Value("${bip.appKey}")
    protected String appKey;

    @Value("${bip.appSecret}")
    protected String appSecret;

    @Override
    public void afterPropertiesSet() throws Exception {
        openGatewayHost = domainUrl + BipOpenApiUriConst.OPEN_GATEWAY_HOST;
        openAuthHost = domainUrl + BipOpenApiUriConst.OPEN_AUTH_HOST;
    }
}
```

### Step 2: 获取AccessToken

```java
@Autowired
AccessTokenUtils accessTokenUtils;

String accessToken = accessTokenUtils.getAccessToken(
    openAuthHost, 
    appKey, 
    appSecret
);
```

### Step 3: 构建请求URL

```java
String requestUrl = openGatewayHost 
    + apiUri 
    + "?access_token=" + accessToken 
    + "&id=" + entityId;
```

### Step 4: 发起调用

```java
Map<String, Object> params = new HashMap<>();
// 添加业务参数
params.put("paramKey", paramValue);

Map<String, Object> result = OpenApiUtils.getMethod(params, requestUrl);
```

### Step 5: 解析响应

```java
if ("200".equals(result.get("code"))) {
    Object data = result.get("data");
    JSONObject jsonObject = JSONObject.parseObject(JsonUtils.toJson(data));
    return jsonObject;
}
return null;
```

## 完整示例

以下为通用调用模板，请根据实际业务替换占位符：

```java
/**
 * BIP API 通用调用模板
 * @param apiUri API路径，如: /yonbip/sd/vouchersaleinvoice/detail
 * @param entityId 业务实体ID
 * @return 业务数据JSONObject
 */
protected JSONObject queryBipEntityById(String apiUri, String entityId) throws Exception {
    // 1. 获取令牌
    String accessToken = accessTokenUtils.getAccessToken(
        openAuthHost, 
        appKey, 
        appSecret
    );
    
    // 2. 构建请求参数
    Map<String, Object> params = new HashMap<>();
    
    // 3. 拼接完整URL
    String requestUrl = openGatewayHost 
        + apiUri 
        + "?access_token=" + accessToken 
        + "&id=" + entityId;
    
    // 4. 发起GET请求
    Map<String, Object> responseMap = OpenApiUtils.getMethod(params, requestUrl);
    
    // 5. 解析响应
    if ("200".equals(responseMap.get("code"))) {
        Object data = responseMap.get("data");
        return JSONObject.parseObject(JsonUtils.toJson(data));
    }
    
    return null;
}

/**
 * POST调用示例 - 保存业务数据
 */
protected JSONObject saveBipEntity(String apiUri, Map<String, Object> businessData) throws Exception {
    // 1. 获取令牌
    String accessToken = accessTokenUtils.getAccessToken(
        openAuthHost, 
        appKey, 
        appSecret
    );
    
    // 2. 构建完整URL
    String requestUrl = openGatewayHost + apiUri + "?access_token=" + accessToken;
    
    // 3. 发起POST请求
    String responseStr = OpenApiUtils.postMethod(businessData, requestUrl, accessToken);
    
    // 4. 解析响应
    JSONObject responseMap = JSONObject.parseObject(responseStr);
    if ("200".equals(responseMap.get("code"))) {
        return responseMap.getJSONObject("data");
    }
    
    return null;
}
```

## 响应标准格式

BIP API返回的标准JSON格式：

```json
{
    "code": "200",
    "data": { ... },
    "message": "success"
}
```

或错误响应：

```json
{
    "code": "500",
    "message": "错误描述",
    "detailMessage": "详细错误信息"
}
```

## 异常处理规范

```java
try {
    Map<String, Object> result = OpenApiUtils.getMethod(params, url);
    
    if (!"200".equals(result.get("code"))) {
        String errorMsg = String.format("BIP API调用失败: code=%s, message=%s",
            result.get("code"), 
            result.get("message")
        );
        throw new RuntimeException(errorMsg);
    }
    
    return result.get("data");
} catch (Exception e) {
    LOGGER.error("调用BIP API异常", e);
    throw new BusinessException("调用BIP接口失败: " + e.getMessage());
}
```

```java

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.Map;
import java.util.TreeMap;
/**
 * 请求开放平台套件授权相关接口的加签类
 *
 * @author platform
 * @date 2023/05/31
 */
public class SignHelper {

    /**
     * 按参数名排序后依次拼接参数名称与数值，之后对该字符串使用 HmacSHA256 加签，加签结果进行 base 64 返回
     *
     * @param params      请求参数 map
     * @param suiteSecret 套件密钥，用作 mac key
     * @return 签名
     * @throws NoSuchAlgorithmException
     * @throws UnsupportedEncodingException
     * @throws InvalidKeyException
     */
    public static String sign(Map<String, Object> params, String suiteSecret) throws NoSuchAlgorithmException, UnsupportedEncodingException, InvalidKeyException {
        // use tree map to sort params by name
        Map<String, Object> treeMap;
        if (params instanceof TreeMap) {
            treeMap = params;
        } else {
            treeMap = new TreeMap<>(params);
        }

        StringBuilder stringBuilder = new StringBuilder();
        for (Map.Entry<String, Object> entry : treeMap.entrySet()) {
            stringBuilder.append(entry.getKey()).append(entry.getValue());
        }

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(suiteSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] signData = mac.doFinal(stringBuilder.toString().getBytes(StandardCharsets.UTF_8));
        String base64String = Base64.getEncoder().encodeToString(signData);
        return URLEncoder.encode(base64String, "UTF-8");
    }

}
```

## GET vs POST 选择

| 场景 | 推荐方式 | 说明 |
|------|---------|------|
| 查询详情 | GET | 参数拼接在URL中，如 `/detail?id=xxx` |
| 分页查询 | POST | 请求体包含分页参数和查询条件 |
| 保存/更新 | POST | 请求体包含完整业务数据 |
| 批量操作 | POST | 请求体包含批量数据数组 |

## 入参准确性规范（强制）

> **⚠️ 核心原则：入参必须严格按照 API 文档构建，禁止臆想参数名和参数类型**

### 入参构建流程

```java
/**
 * 根据 API 文档构建入参
 * @param apiInfo API查询结果（来自Python脚本）
 * @param bizData 业务数据
 * @return 构建好的请求参数
 */
public Map<String, Object> buildRequestParams(Map<String, Object> apiInfo, Map<String, Object> bizData) {
    Map<String, Object> params = new HashMap<>();

    // 1. 获取入参列表（来自API查询结果）
    List<Map<String, Object>> inputParams = (List<Map<String, Object>>) apiInfo.get("入参列表");

    for (Map<String, Object> param : inputParams) {
        String paramName = (String) param.get("参数名");
        Boolean required = (Boolean) param.get("必填");
        String paramType = (String) param.getOrDefault("参数类型", "String");
        Object defaultValue = param.get("默认值");

        // 必填参数校验
        if (Boolean.TRUE.equals(required)) {
            if (!bizData.containsKey(paramName) && defaultValue == null) {
                throw new IllegalArgumentException("必填参数[" + paramName + "]未提供");
            }
        }

        // 获取参数值
        Object value = bizData.get(paramName);
        if (value == null) {
            value = defaultValue;
        }

        // 类型转换
        params.put(paramName, convertValue(value, paramType));
    }

    return params;
}

/**
 * 参数类型转换
 */
private Object convertValue(Object value, String paramType) {
    if (value == null) return null;

    switch (paramType.toLowerCase()) {
        case "integer":
        case "int":
            if (value instanceof Number) return ((Number) value).intValue();
            return Integer.parseInt(value.toString());
        case "long":
            if (value instanceof Number) return ((Number) value).longValue();
            return Long.parseLong(value.toString());
        case "double":
        case "decimal":
            if (value instanceof Number) return ((Number) value).doubleValue();
            return Double.parseDouble(value.toString());
        case "boolean":
            if (value instanceof Boolean) return value;
            return Boolean.parseBoolean(value.toString());
        default:
            return value.toString();
    }
}
```

### 禁止臆想参数

```java
// ❌ 错误：臆想参数名（可能与实际API不符）
Map<String, Object> params = new HashMap<>();
params.put("product_code", code);      // 参数名可能是 productCode
params.put("org_id", orgId);           // 参数名可能是 orgId 或 orgCode

// ✅ 正确：使用API查询结果的参数名
List<Map<String, Object>> inputParams = apiInfo.get("入参列表");
for (Map<String, Object> param : inputParams) {
    String paramName = (String) param.get("参数名");
    params.put(paramName, bizData.get(paramName));
}
```

## 出参解析规范（强制）

> **⚠️ 核心原则：出参必须严格按照 API 文档解析，确保数据准确性**

### 出参解析流程

```java
/**
 * 根据 API 文档解析出参
 * @param response API响应字符串
 * @param apiInfo API查询结果（来自Python脚本）
 * @param targetClass 目标类型
 * @return 解析后的对象
 */
public <T> T parseResponse(String response, Map<String, Object> apiInfo, Class<T> targetClass) {
    // 1. 解析响应字符串
    JSONObject result = JSON.parseObject(response);

    // 2. 校验响应码
    String code = result.getString("code");
    if (!"200".equals(code)) {
        String message = result.getString("message");
        throw new RuntimeException("API调用失败: code=" + code + ", message=" + message);
    }

    // 3. 获取出参结构（来自API查询结果）
    Map<String, Object> outputStruct = (Map<String, Object>) apiInfo.get("出参结构");

    // 4. 按出参结构解析数据
    Object data = result.get("data");
    if (data == null) {
        return null;
    }

    // 5. 转换为目标类型
    String dataJson = JSON.toJSONString(data);
    return JSON.parseObject(dataJson, targetClass);
}
```

### 出参结构示例

```java
// API返回结构
// {
//   "code": "200",
//   "data": {
//     "id": 123,
//     "billno": "INV2024010001",
//     "creator": {
//       "id": 456,
//       "name": "张三"
//     },
//     "items": [
//       {"productCode": "P001", "qty": 10, "price": 100.00}
//     ]
//   },
//   "message": "success"
// }

// 出参结构（来自API查询结果）
// {
//   "code": {"类型": "String", "描述": "响应码"},
//   "data": {
//     "类型": "Object",
//     "子字段": {
//       "id": {"类型": "Long", "描述": "单据ID"},
//       "billno": {"类型": "String", "描述": "单据号"},
//       "creator": {
//         "类型": "Object",
//         "子字段": {
//           "id": {"类型": "Long", "描述": "创建人ID"},
//           "name": {"类型": "String", "描述": "创建人姓名"}
//         }
//       },
//       "items": {"类型": "Array", "描述": "明细行"}
//     }
//   }
// }

// 解析为 DTO
public class InvoiceDTO {
    private Long id;
    private String billno;
    private CreatorDTO creator;
    private List<InvoiceItemDTO> items;
    // getter/setter
}

// 使用
InvoiceDTO invoice = parseResponse(response, apiInfo, InvoiceDTO.class);
```

## 最佳实践

1. **统一入口**: 所有BIP API调用必须经过本框架，确保鉴权和异常处理一致
2. **配置分离**: API地址、appKey、appSecret等配置放在配置文件中
3. **日志记录**: 记录请求URL、参数、响应状态，便于问题排查
4. **异常封装**: 自定义业务异常类，区分系统异常和业务异常
5. **超时控制**: 为RestTemplate配置连接超时和读取超时
6. **重试机制**: 对于非幂等性操作，考虑添加重试机制
7. **Token缓存**: 生产环境建议实现Token缓存机制，避免频繁请求

## 扩展建议

1. **Token自动刷新**: 实现Token过期自动刷新机制
2. **统一响应包装**: 封装统一的响应结果类
3. **日志追踪**: 添加请求ID便于日志追踪
4. **熔断降级**: 集成Sentinel或Hystrix实现熔断
5. **API版本管理**: 不同版本API使用不同URI常量类
