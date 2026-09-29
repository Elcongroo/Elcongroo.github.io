---
title: "OpenVPN / TLS / TLCP / Tongsuo 上游源码研究与国密改造点定位"
description: "在 OpenVPN 与 Tongsuo 边界定位 TLCP、证书和数据通道改造点。"
date: "2026-09-29"
updated: "2026-09-29"
category: "crypto"
modules: ["tls", "crypto", "provider"]
editorial: "original"
tags: ["OpenVPN", "TLS", "国密协议与改造"]
kind: "源码精读"
minutes: 50
featured: false
series: "国密协议与改造"
seriesOrder: 2
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["OpenVPN 2.7.4；涉及 Tongsuo 时按正文指定版本"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "OpenVPN / TLS / TLCP / Tongsuo 上游源码研究与国密改造点定位", "mode": "原稿收录", "omissions": []}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。"}]
repository: "https://github.com/OpenVPN/openvpn/tree/v2.7.4"
basis: {"label": "OpenVPN 2.7.4 源码", "href": "https://github.com/OpenVPN/openvpn/tree/v2.7.4", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

## 1. 文档目的与研究边界

### 1.1 项目定位

本项目 OEM 一个已实现国密化的四合一安全网关（IPsec VPN / SSL VPN / 零信任 / 证书服务器）。其中 **SSL VPN 能力的技术路线基于 OpenVPN**（TLS / TLCP 控制通道 + 数据通道），密码库侧为 Tongsuo。

接手该产品前，需要掌握 OpenVPN 的技术路线，并定位国密改造点——理解上游为实现 TLCP 化需要在哪些源码边界落笔。这些改造点是理解、评测与排障产品内部 SSL VPN 国密实现的入口地图。

本文研究的是**未针对本项目做国密适配的开源代码本身**，回答以下问题：

1. OpenVPN 的 TLS 控制通道从哪里进入密码库；
2. OpenVPN 上游对 TLS 方法、证书、私钥、Cipher、TLS Exporter 有哪些既有假设；
3. Tongsuo 已经在哪些位置完整实现 TLCP、双证书、SM2/SM3/SM4 和记录层；
4. 如果要让 OpenVPN 使用 Tongsuo 的 TLCP 能力，最小且可维护的改造边界在哪里；
5. 哪些地方属于“接入改造”，哪些地方属于“协议实现”，哪些地方原则上不应重复实现；
6. TLCP 控制通道成功后，为什么仍不能直接宣称 OpenVPN 业务数据通道已经国密化。

本文不是既有 PoC 补丁说明。文中出现的“改造点”表示：**从上游源码结构推导出的候选修改位置**，而不是声称这些修改已经在产品中完成。

### 1.2 研究边界

| 项 | 内容 |
| --- | --- |
| 研究基线 | OpenVPN 2.7.4；Tongsuo 8.4.0（`a8ae0925d26de3b449f7a21767910cd41291bcd8`） |
| 行号口径 | 行号只服务于当前版本快照。升级版本后，应以函数名和符号搜索重新定位，不能只按旧行号修改 |

### 1.3 证据标注

本文遵循《GM-VPN 技术文档写作规范》第 12 章的六类标注：

| 标注 | 含义 |
| --- | --- |
| 【源码确认】 | 已在 OpenVPN 2.7.4 / Tongsuo 8.4.0 源码中定位到函数、字段或调用关系 |
| 【运行确认】 | 已通过调试或日志确认 |
| 【抓包确认】 | 已通过 PCAP 确认 |
| 【标准定义】 | 来自 TLCP / SSL VPN 标准或密码算法标准 |
| 【推测】 | 基于源码结构得出的工程判断（含“改造点”类结论），推理依据见所在段落 |
| 【待验证】 | 静态源码无法证明，需编译、日志、断点、抓包或互通测试确认 |

---

## 2. 基线：OpenVPN 和 Tongsuo 分别负责什么

OpenVPN 不是 TLS 协议栈本身。它把 TLS 作为控制通道的认证和密钥协商载体，并通过密码后端接口将具体 TLS 工作交给 OpenSSL 类库。

Tongsuo 则是在 OpenSSL 兼容接口基础上增加 TLCP/NTLS、SM2 双证书和国密 Cipher Suite 的密码库。因此，从上游代码结构看，正确的总体关系是：

```text
OpenVPN
  │
  │  控制通道状态、可靠传输、配置、证书文件路径、数据通道密钥管理
  ▼
OpenVPN TLS backend (ssl_backend.h / ssl_openssl.c)
  │
  │  SSL_CTX / SSL / BIO API
  ▼
Tongsuo libssl
  │
  ├─ 普通 TLS 状态机
  └─ TLCP/NTLS 状态机
       │
       ├─ 双证书
       ├─ SM2 密钥建立/签名
       ├─ SM3 PRF / MAC
       └─ SM4 记录保护
```

**【推测】**：如果目标是“OpenVPN 控制通道使用 TLCP”，首选方案不是在 OpenVPN 内重新实现 TLCP 报文，而是让 OpenVPN 的 OpenSSL backend 正确创建、配置和驱动 Tongsuo 的 NTLS `SSL_CTX/SSL` 对象。

---

## 3. OpenVPN 上游：控制通道从哪里进入 TLS 后端

### 3.1 `init_ssl()`：OpenVPN 的 TLS 根上下文入口

源码：

```text
src/openvpn/ssl.c
    init_ssl(const struct options *options, bool in_chroot)
```

在 OpenVPN 2.7.4 中，`init_ssl()` 是建立全局 TLS 根上下文的关键入口。其逻辑顺序可以概括为：

```text
options
  │
  ├─ tls_server ?
  │      ├─ yes -> tls_ctx_server_new()
  │      └─ no  -> tls_ctx_client_new()
  │
  ├─ tls_ctx_set_cert_profile()
  ├─ tls_ctx_restrict_ciphers()
  ├─ tls_ctx_restrict_ciphers_tls13()
  ├─ tls_ctx_set_tls_groups()
  ├─ tls_ctx_set_options()
  │
  ├─ tls_ctx_load_cert_file() / PKCS#11 / CryptoAPI / external cert
  ├─ tls_ctx_load_priv_file() / external private key
  ├─ tls_ctx_load_ca()
  └─ server: tls_ctx_load_ecdh_params()
```

**【源码确认】**：这一层没有构造 ClientHello、Certificate 或 Finished；它主要组织 OpenVPN 配置，并调用 `ssl_backend.h` 暴露的后端接口。

### 3.2 `ssl_backend.h` 是最重要的改造边界之一

源码：

```text
src/openvpn/ssl_backend.h
```

OpenVPN 将不同 TLS 库的实现隔离在 backend 接口后面。重点接口包括：

```text
tls_ctx_server_new()
tls_ctx_client_new()
tls_ctx_set_options()
tls_ctx_restrict_ciphers()
tls_ctx_load_cert_file()
tls_ctx_load_priv_file()
key_state_ssl_init()
key_state_export_keying_material()
key_state_write_plaintext()
key_state_read_ciphertext()
key_state_write_ciphertext()
key_state_read_plaintext()
```

这说明 OpenVPN 上游已经具备一个非常有价值的架构特征：

> 上层 `ssl.c` 主要关心“需要一个 TLS 控制通道”，而不应直接关心 OpenSSL 内部状态机。

**【推测】**：TLCP 接入首先应落在 OpenSSL/Tongsuo backend 及相应配置模型中。除非 TLCP 与 OpenVPN 上层的控制通道语义发生冲突，否则不应把 TLCP 状态机逻辑散落到 `ssl.c`。

---

## 4. OpenVPN 上游第一处关键假设：只创建普通 TLS 方法

源码：`src/openvpn/ssl_openssl.c`

### 4.1 服务端

OpenVPN 2.7.4：

```text
ssl_openssl.c:97  tls_ctx_server_new()
ssl_openssl.c:101 SSL_CTX_new_ex(..., SSLv23_server_method())
```

其核心行为是：

```c
ctx->ctx = SSL_CTX_new_ex(tls_libctx, NULL, SSLv23_server_method());
```

### 4.2 客户端

```text
ssl_openssl.c:115 tls_ctx_client_new()
ssl_openssl.c:118 SSL_CTX_new_ex(..., SSLv23_client_method())
```

即：

```c
ctx->ctx = SSL_CTX_new_ex(tls_libctx, NULL, SSLv23_client_method());
```

### 4.3 为什么这里是 TLCP 接入的第一个候选改造点

Tongsuo 8.4.0 已经提供：

```text
ssl/methods.c:298 NTLS_method()
ssl/methods.c:303 NTLS_server_method()
ssl/methods.c:308 NTLS_client_method()
```

因此两边天然形成接口对应关系：

```text
OpenVPN tls_ctx_server_new()
          │
          ├─ 上游：SSLv23_server_method()
          └─ TLCP候选：NTLS_server_method()

OpenVPN tls_ctx_client_new()
          │
          ├─ 上游：SSLv23_client_method()
          └─ TLCP候选：NTLS_client_method()

TLCP context
          └─ SSL_CTX_enable_ntls() / 对应 NTLS 启用语义
```

Tongsuo 8.4.0 的 `ssl/ssl_lib.c:6527 SSL_CTX_enable_ntls()` 会在 `SSL_CTX` 上设置 NTLS 分派标志；`SSL_new()` 再把该状态带到连接对象。因此工程接入时必须同时确认“使用的 method”和“NTLS 分派状态”是否都符合 Tongsuo 当前 API 语义，不能只看到 `NTLS_*_method()` 就停止追踪。

**【推测】**：应由明确的 OpenVPN 配置状态决定选择普通 TLS 还是 TLCP，而不能仅依赖环境变量、编译时硬切换或密码库版本号猜测。

推荐抽象语义是：

```text
options / tls_root_ctx
     │
     ├─ protocol = TLS
     │     └─ SSLv23/TLS method
     │
     └─ protocol = TLCP
           └─ Tongsuo NTLS method
```

这样普通 TLS 路径保持原样，TLCP 是显式配置能力，而不是隐式替换。

---

## 5. 第二处关键假设：OpenVPN 的版本控制逻辑默认“协议就是 TLS”

源码：`src/openvpn/ssl_openssl.c`

```text
ssl_openssl.c:230 openssl_tls_version()
ssl_openssl.c:267 tls_ctx_set_tls_versions()
```

上游逻辑将 OpenVPN 内部版本枚举映射到：

```text
TLS1_VERSION
TLS1_1_VERSION
TLS1_2_VERSION
TLS1_3_VERSION
```

当用户没有显式设置最小版本时：

```text
ssl_openssl.c:273-278
```

会确保：

```c
min_version >= TLS1_VERSION
```

随后：

```text
ssl_openssl.c:280 SSL_CTX_set_min_proto_version()
```

### 5.1 与 Tongsuo NTLS 的冲突点

Tongsuo 内部 TLCP 使用 `NTLS_VERSION`，其数值空间与普通 TLS 的 `TLS1_VERSION` 不同。

因此，简单地把：

```c
SSLv23_*_method()
```

改成：

```c
NTLS_*_method()
```

并不能保证完整工作；OpenVPN 后续的版本限制代码仍可能把 context 按普通 TLS 约束。

**【推测】**：TLCP 模式下必须重新审查：

```c
tls_ctx_set_options()
  └─ tls_ctx_set_tls_versions()
```

至少要保证普通 TLS 的最小/最大版本约束不会错误覆盖 Tongsuo 的 NTLS 版本。

这个点非常典型：

> “方法表切换成功”不等于“协议模式切换完成”。

---

## 6. 第三处关键假设：OpenVPN 上游只有一套本端证书/私钥

### 6.1 普通证书加载

源码：`src/openvpn/ssl_openssl.c`

```text
ssl_openssl.c:1192 tls_ctx_load_cert_pem_file()
ssl_openssl.c:1222 SSL_CTX_use_certificate()
ssl_openssl.c:1249 tls_ctx_load_cert_file()
```

普通 PEM 证书最终进入：

```c
SSL_CTX_use_certificate(ctx->ctx, x);
```

### 6.2 普通私钥加载

```text
ssl_openssl.c:1261 tls_ctx_load_priv_file()
ssl_openssl.c:1286 SSL_CTX_use_PrivateKey()
ssl_openssl.c:1299 SSL_CTX_check_private_key()
```

对象模型实际是：

```text
OpenVPN options
   │
   ├─ cert_file ──────┐
   └─ priv_key_file ──┴─> SSL_CTX 单证书/私钥语义
```

### 6.3 TLCP 为什么在这里必然需要上层适配

Tongsuo 8.4.0 的 TLCP 不是简单把一个普通证书换成 SM2 证书。它定义了不同角色：

```text
ssl/ssl_local.h:385 SSL_PKEY_SM2_SIGN = 7
ssl/ssl_local.h:386 SSL_PKEY_SM2_ENC  = 8
```

而 `CERT_PKEY` 中分别保存：

```text
X509 *x509;
EVP_PKEY *privatekey;
```

所以目标对象是：

```text
CERT
├─ pkeys[SSL_PKEY_SM2_SIGN]
│    ├─ SIGN X509
│    └─ SIGN EVP_PKEY
│
└─ pkeys[SSL_PKEY_SM2_ENC]
     ├─ ENC X509
     └─ ENC EVP_PKEY
```

Tongsuo 已经提供专用 API：

```text
ssl/ssl_rsa.c:1312 SSL_CTX_use_enc_PrivateKey()
ssl/ssl_rsa.c:1333 SSL_CTX_use_enc_PrivateKey_file()
ssl/ssl_rsa.c:1372 SSL_CTX_use_sign_PrivateKey()
ssl/ssl_rsa.c:1393 SSL_CTX_use_sign_PrivateKey_file()
ssl/ssl_rsa.c:1433 SSL_CTX_use_enc_certificate()
ssl/ssl_rsa.c:1473 SSL_CTX_use_enc_certificate_file()
ssl/ssl_rsa.c:1515 SSL_CTX_use_sign_certificate()
ssl/ssl_rsa.c:1556 SSL_CTX_use_sign_certificate_file()
```

因此这里的正确工程判断是：

> 双证书能力在 Tongsuo 中已经存在；OpenVPN 缺的是“配置表达 + 调用正确 API + 生命周期/错误处理”的接入层。

### 6.4 推荐的 OpenVPN 配置模型改造点

上游 OpenVPN 的 `options` 只有普通 `cert/key` 语义。产品化接入时应考虑增加明确的 TLCP 参数，例如逻辑上：

```text
tlcp-sign-cert
tlcp-sign-key
tlcp-enc-cert
tlcp-enc-key
```

名称可按产品配置体系最终确定，但关键要求是：

1. SIGN 和 ENC 必须在配置模型中就是两个不同角色；
2. 不能只在底层通过文件名规则猜角色；
3. 将来切 HSM/Provider/PKCS#11 时，配置仍能表达两个独立私钥句柄；
4. 缺任一必需角色应安全失败，不应静默退成普通 TLS 或复用另一把私钥。

---

## 7. Tongsuo 双证书内部为什么能保持角色不混淆

### 7.1 写入槽位

Tongsuo `ssl/ssl_rsa.c` 的 setter 最终把证书/私钥写到特定 `pkeys[i]`。

核心辅助函数：

```text
ssl/ssl_rsa.c:1242 ssl_set_cert_idx()
ssl/ssl_rsa.c:1281 ssl_set_pkey_idx()
```

逻辑上：

```text
SSL_CTX_use_sign_certificate()
    └─ i = SSL_PKEY_SM2_SIGN
       └─ c->pkeys[i].x509 = SIGN cert

SSL_CTX_use_sign_PrivateKey()
    └─ i = SSL_PKEY_SM2_SIGN
       └─ c->pkeys[i].privatekey = SIGN key

SSL_CTX_use_enc_certificate()
    └─ i = SSL_PKEY_SM2_ENC
       └─ c->pkeys[i].x509 = ENC cert

SSL_CTX_use_enc_PrivateKey()
    └─ i = SSL_PKEY_SM2_ENC
       └─ c->pkeys[i].privatekey = ENC key
```

### 7.2 证书用途检查也是角色化的

`SSL_CTX_use_enc_certificate()` 和 `SSL_CTX_use_sign_certificate()` 不是简单别名。

前者会检查加密证书的 Key Usage，后者会检查签名相关用途。说明 Tongsuo 在**装载阶段**就试图区分两张证书的用途。

**【推测】**：OpenVPN 接入层应保持这些 Tongsuo API 的语义，不应为了“统一代码”而把双证书都先装入普通 `SSL_CTX_use_certificate()` 再自行缓存。

---

## 8. `SSL_CTX` 到单连接 `SSL`：OpenVPN 和 Tongsuo 的对象边界

OpenVPN 创建每条实际控制通道连接时进入：

```text
src/openvpn/ssl_openssl.c:2079 key_state_ssl_init()
```

其中：

```c
ssl_openssl.c:2086 SSL_new(ssl_ctx->ctx)
```

Tongsuo 的 `SSL_new()`：

```c
ssl/ssl_lib.c:689 SSL_new()
ssl/ssl_lib.c:727 s->enable_ntls = ctx->enable_ntls
ssl/ssl_lib.c:752 s->cert = ssl_cert_dup(ctx->cert)
```

所以对象生命周期是：

```text
初始化阶段                         每条连接

SSL_CTX::CERT  ---------------->  SSL::CERT
 SIGN slot       ssl_cert_dup()    SIGN slot
 ENC slot                          ENC slot
```

后续握手状态机读取的是这条连接自己的 `SSL::cert`。

这个边界非常重要，因为它解释了：

- 双证书不是在收到 `ClientKeyExchange` 时临时重新读文件；
- HSM 接入也应该在证书/私钥对象建立阶段完成对象绑定；
- 后续状态机只消费 `EVP_PKEY`，不应该知道私钥来自 PEM、Provider 还是密码卡。

---

## 9. Memory BIO 边界：OpenVPN 无需理解 TLCP 每一条握手报文

`key_state_ssl_init()` 后半段：

```text
ssl_openssl.c:2095 BIO_new(BIO_f_ssl())
ssl_openssl.c:2096 BIO_new(BIO_s_mem())  -> ct_in
ssl_openssl.c:2097 BIO_new(BIO_s_mem())  -> ct_out
ssl_openssl.c:2106 SSL_set_accept_state()
ssl_openssl.c:2110 SSL_set_connect_state()
ssl_openssl.c:2113 SSL_set_bio()
ssl_openssl.c:2114 BIO_set_ssl()
```

随后 OpenVPN 只在以下接口之间搬运明文和密文：

```text
key_state_write_plaintext()
key_state_read_ciphertext()
key_state_write_ciphertext()
key_state_read_plaintext()
```

可以把它理解成：

```text
OpenVPN 上层控制消息
      │ plaintext
      ▼
    SSL BIO
      │
      │ Tongsuo 状态机、记录层
      ▼
   ct_out BIO
      │
      ▼
OpenVPN reliable/control packet
      │ 网络
      ▼
对端
```

接收方向反过来：

```text
网络密文 -> ct_in BIO -> Tongsuo -> SSL BIO -> OpenVPN 明文控制消息
```

**【推测】**：这是最关键的“无需重写层”。只要 Tongsuo 的 `SSL` 对象处于 NTLS 状态机，OpenVPN 的 Memory BIO 桥接原则上可以继续复用。

---

## 10. Tongsuo 是如何从普通 TLS 分派到 TLCP 状态机的

### 10.1 方法表

```text
ssl/methods.c:178-192 NTLS method table 实现
ssl/methods.c:303 NTLS_server_method()
ssl/methods.c:308 NTLS_client_method()
```

### 10.2 NTLS 标志

```text
ssl/ssl_lib.c:6527 SSL_CTX_enable_ntls()
```

`SSL_new()` 会把 context 的 NTLS 标志带到 `SSL` 对象。

### 10.3 connect/accept 分派

源码：

```text
ssl/statem/statem.c:266 ossl_statem_connect()
ssl/statem/statem.c:284 ossl_statem_accept()
```

逻辑可以简化为：

```text
SSL_connect / SSL_accept
        │
        ▼
ossl_statem_connect / accept
        │
        ├─ 普通 TLS -> state_machine()
        │
        └─ NTLS     -> state_machine_ntls()
```

Tongsuo 的 TLCP 总状态机：

```text
ssl/statem_ntls/ntls_statem.c:307 state_machine_ntls()
```

之后按客户端/服务端进入：

```text
ssl/statem_ntls/ntls_statem_clnt.c
ssl/statem_ntls/ntls_statem_srvr.c
```

**【源码确认】**：OpenVPN 不需要自己生成 TLCP `ClientHello/ServerHello/Certificate/ServerKeyExchange/...`。这些都属于 Tongsuo 已经实现的协议层。

---

## 11. `ECC-SM2-SM4-CBC-SM3` 为什么能证明是静态 SM2 主链

Tongsuo 的 Cipher Suite 描述位于：

```text
ssl/s3_lib.c:2386 起
ssl/t1_trce.c:319  0xE013 -> ECC_SM4_CBC_SM3
```

因此当前研究的 `ECC-SM2-SM4-CBC-SM3` 线上 Cipher Suite 值可直接在 Tongsuo 8.4.0 源码中锚定为 `0xE013`。这里要区分“线上 16-bit suite 值”和 Tongsuo 内部用于组织 cipher 属性的结构/常量。

该套件的关键字段包括：

```text
SSL_kSM2
SSL_aSM2
SSL_SM4
SSL_SM3
SSL_HANDSHAKE_MAC_SM3 | TLS1_PRF_SM3
```

这里最关键的是：

```text
SSL_kSM2
```

而不是：

```text
SSL_kSM2DHE
```

Tongsuo 对两种模式有不同分支。因此对于该套件，其主链是静态 SM2 密钥传输：

```text
客户端生成 PMS
  │
  ├─ 取服务端 ENC 证书公钥
  ├─ SM2 加密 PMS
  ▼
ClientKeyExchange
  │
  ▼
服务端 ENC 私钥解密 PMS
```

这和 SM2DHE 的临时密钥交换是两条不同源码路径。

---

## 12. SIGN 私钥为什么会真正参与握手

服务端关键函数：

```text
ssl/statem_ntls/ntls_statem_srvr.c:1630
    tls_construct_server_key_exchange_ntls()
```

在静态 SM2 分支中，函数明确取得：

```c
s->cert->pkeys[SSL_PKEY_SM2_SIGN].privatekey
s->cert->pkeys[SSL_PKEY_SM2_ENC].x509
```

随后：

```text
EVP_DigestSignInit_ex()
EVP_DigestSign()
```

因此角色链是：

```text
SIGN private key
       │
       └─ 对握手待签数据进行数字签名

ENC certificate
       │
       └─ 作为被绑定的加密证书信息参与待签数据构造
```

### 12.1 这对改造意味着什么

如果未来把私钥放入 HSM，OpenVPN 不需要在这个状态机函数里调用厂商 SDK。

更合理的是：

```text
HSM / Provider / ENGINE / PKCS#11
        │
        ▼
EVP_PKEY (SIGN)
        │
        ▼
pkeys[SSL_PKEY_SM2_SIGN]
        │
        ▼
EVP_DigestSign*
```

Tongsuo 状态机仍然不变。

---

## 13. ENC 公钥和私钥如何真正进入 PMS 密钥建立

### 13.1 客户端：用服务端 ENC 公钥加密 PMS

源码：

```text
ssl/statem_ntls/ntls_statem_clnt.c:1893 tls_construct_cke_pms_ntls()
ssl/statem_ntls/ntls_statem_clnt.c:2026 tls_construct_client_key_exchange_ntls()
```

关键对象关系：

```text
peer_chain[0] = 服务端 SIGN 证书
peer_chain[1] = 服务端 ENC 证书
```

客户端从第二张证书取得：

```text
X509_get0_pubkey(ENC certificate)
```

生成 PMS 后调用：

```text
EVP_PKEY_encrypt_init()
EVP_PKEY_encrypt()
```

并把密文写入 `ClientKeyExchange`。

### 13.2 服务端：用 ENC 私钥解密 PMS

源码：

```text
ssl/statem_ntls/ntls_statem_srvr.c:1827 tls_process_cke_pms_ntls()
```

静态 SM2 分支明确读取：

```text
s->cert->pkeys[SSL_PKEY_SM2_ENC].privatekey
```

随后：

```text
EVP_PKEY_decrypt_init()
EVP_PKEY_decrypt()
```

解出 PMS 后进入 Master Secret 派生。

因此双证书角色不能简单写成“一个签名，一个加密”就结束，而应该写成完整消费者关系：

```text
SIGN 私钥 -> ServerKeyExchange 签名
ENC  证书 -> 被 SIGN 私钥绑定 + 客户端获得 ENC 公钥
ENC  公钥 -> 客户端加密 PMS
ENC  私钥 -> 服务端解密 PMS
```

---

## 14. PMS 之后：SM3 PRF、Master Secret 和 Key Block

Tongsuo 复用了 TLS1 类的密钥派生框架：

```text
ssl/t1_enc.c:25  tls1_PRF()
ssl/t1_enc.c:493 tls1_setup_key_block()
ssl/t1_enc.c:604 tls1_generate_master_secret()
```

在目标 NTLS Cipher Suite 中，Cipher 描述带有：

```text
TLS1_PRF_SM3
```

因此可以从源码建立：

```text
PMS
 + Client Random
 + Server Random
        │
        ▼
SM3-based PRF
        │
        ▼
Master Secret
        │
        ▼
Key Block
        │
        ├─ client MAC key
        ├─ server MAC key
        ├─ client encryption key
        ├─ server encryption key
        └─ IV material
```

**【推测】**：OpenVPN 接 Tongsuo 时不应重新实现这套 TLCP Key Schedule。只要套件和状态机正确进入 Tongsuo，这部分应该由 Tongsuo 自身完成。

---

## 15. TLCP 记录保护真正在哪里执行

Tongsuo 记录层重点位置：

```text
ssl/record/ssl3_record.c:855  ssl3_enc()
ssl/record/ssl3_record.c:1396 tls1_mac()
```

对于 CBC + HMAC 模式，可以概括为：

```text
握手/应用记录明文
   │
   ├─ HMAC-SM3 完整性保护
   └─ SM4-CBC 对称加密
   ▼
TLCP record ciphertext
```

到这里为止，能证明的是：

> Tongsuo 所承载的 TLCP 控制通道记录使用目标国密算法。

不能从这一事实直接推导：

> OpenVPN IP 数据业务通道也使用相同 SM4/HMAC-SM3。

因为 OpenVPN 数据通道是另一套对象和密钥生命周期。

---

## 16. OpenVPN 最容易被误判的边界：TLS/TLCP 控制通道 != 数据通道

OpenVPN 自己在 `ssl.c` 中明确承担：

```text
TLS session
   │
   ▼
派生/交换 OpenVPN data-channel key material
   │
   ▼
OpenVPN data cipher / packet protection
```

因此至少要区分：

```text
层 1：TLS/TLCP Record
  保护 OpenVPN 控制通道

层 2：OpenVPN Data Channel
  保护用户 IP 数据包
```

这是整个 TLCP 改造文档最重要的系统边界之一。

---

## 17. TLS Exporter 是 OpenVPN 与 TLCP 之间的真实接口风险点

OpenVPN 2.7.4 OpenSSL backend：

```text
ssl_openssl.c:150 key_state_export_keying_material()
ssl_openssl.c:156 SSL_export_keying_material()
```

这说明 OpenVPN 可以从 TLS 会话导出 keying material，再用于自身数据通道密钥派生。

Tongsuo 8.4.0 的公共接口：

```text
ssl/ssl_lib.c:3209 SSL_export_keying_material()
```

其前置检查是：

```text
session 必须存在
且 version 不能小于 TLS1_VERSION（DTLS 特例除外）
```

但 NTLS 的版本值位于另一数值空间，因此会在到达 method table 的 exporter 之前被拒绝。

### 17.1 为什么这是“接入边界”，而不是 TLCP 握手 bug

因为此时可能已经出现：

```text
TLCP handshake = 成功
TLCP record    = 成功
SSL exporter   = 失败
```

它说明：

> Tongsuo 的 TLCP 协议实现与 OpenVPN 对 TLS API 的使用假设之间存在接口不一致。

### 17.2 候选改造方向

这里必须做产品级设计选择，而不能临时绕过：

**方向 A：Tongsuo 层补齐 NTLS-aware exporter 公共 API 语义**

优点：OpenVPN 上层继续使用标准 exporter 抽象。  
风险：必须确认 TLCP exporter 的定义、标签、上下文以及互通语义。

**方向 B：OpenVPN backend 增加 TLCP 专用的 key-material export/PRF 适配**

优点：修改边界留在 OpenVPN/Tongsuo 适配层。  
风险：协议兼容、数据通道协商和回退规则必须单独定义。

**不能接受的设计**：exporter 失败后静默使用另一套密钥派生，却仍把功能描述为“OpenVPN 已完整国密化”。

---

## 18. 从上游源码反推的 OpenVPN TLCP 改造点

下面按真正需要修改的层次排列。

### 18.1 构建与能力探测

**候选位置**：CMake/configure 的 OpenSSL feature detection。

不能只检查：

```text
OPENSSL_VERSION_NUMBER
```

应检测实际符号能力，例如：

```text
NTLS_client_method
NTLS_server_method
SSL_CTX_enable_ntls
SSL_CTX_use_sign_certificate*
SSL_CTX_use_enc_certificate*
```

原因：OpenSSL、Tongsuo、不同 Provider 组合可能版本号相近但 API 能力不同。

### 18.2 OpenVPN 配置模型

**候选位置**：`options.h/options.c` 及配置解析。

至少需要表达：

```text
protocol mode: TLS / TLCP
SIGN certificate / key
ENC  certificate / key
TLCP cipher suite policy
是否允许兼容/回退
```

该层决定的是“用户想要什么”，不应把策略隐藏在 `ssl_openssl.c` 的环境变量或宏里。

### 18.3 TLS method/context 创建

**候选位置**：

```text
src/openvpn/ssl_openssl.c
    tls_ctx_server_new()
    tls_ctx_client_new()
```

职责：根据显式模式选择 Tongsuo NTLS method，同时保持普通 TLS 分支不变。

### 18.4 TLS version 逻辑

**候选位置**：

```text
ssl_openssl.c
    openssl_tls_version()
    tls_ctx_set_tls_versions()
    tls_ctx_set_options()
```

职责：避免普通 TLS 版本约束破坏 NTLS context。

### 18.5 双证书装载

**候选位置**：

```text
ssl_openssl.c
    tls_ctx_load_cert_file()
    tls_ctx_load_priv_file()
```

或新增一个独立的 TLCP certificate loader，由 `init_ssl()` 组织调用。

推荐逻辑：

```text
TLCP mode
  │
  ├─ load SIGN certificate -> Tongsuo SIGN API
  ├─ load SIGN private key -> Tongsuo SIGN API
  ├─ verify pair/usage
  │
  ├─ load ENC certificate  -> Tongsuo ENC API
  ├─ load ENC private key  -> Tongsuo ENC API
  └─ verify pair/usage
```

不建议把两个角色塞进现有单 `cert/key` 字段然后依赖调用顺序猜测。

### 18.6 Cipher Suite 控制

上游入口：

```text
ssl_openssl.c:421 tls_ctx_restrict_ciphers()
ssl_openssl.c:426 SSL_CTX_set_cipher_list()
```

需要确认：

1. Tongsuo 的 NTLS suite 名称如何传入；
2. 普通 OpenVPN cipher alias 转换是否会错误处理 NTLS 名称；
3. 是否要允许多套件还是产品固定套件；
4. 抓包最终线上值是否与目标标准一致。

注意上游默认策略还显式禁用了某些 static DH 类算法，这说明 OpenVPN 的 TLS 安全策略是按照普通 TLS 设计的；TLCP 模式不能机械复用每一条 Cipher 过滤规则。

### 18.7 `SSL/BIO` 连接对象

候选位置：

```text
key_state_ssl_init()
```

**预期改动应尽量为零或极小。**

这里是稳定抽象层：只创建 `SSL`、设置 client/server state 并接 Memory BIO。协议细节应留给 Tongsuo。

### 18.8 Exporter / OpenVPN 数据通道

候选位置：

```text
key_state_export_keying_material()
OpenVPN data-channel key expansion path
```

必须单独设计和验证，不能由“TLCP 控制通道通了”代替。

---

## 19. 哪些代码原则上不应为了接入而修改

如果目标只是“OpenVPN 使用 Tongsuo 已有 TLCP”，以下 Tongsuo 核心代码原则上应该视作**已存在的协议实现**，不是第一改造选择：

```text
ssl/statem_ntls/ntls_statem.c
ssl/statem_ntls/ntls_statem_clnt.c
ssl/statem_ntls/ntls_statem_srvr.c
ssl/t1_enc.c
ssl/record/
```

只有在以下情况才应进入这些文件修改：

1. 目标标准与 Tongsuo 当前实现存在明确差异；
2. 抓包证明线上行为与标准不符；
3. 对端互通暴露出 Tongsuo 协议实现缺陷；
4. 新增 TLCP 本身没有的协议能力，例如确定后的 PQC/混合密钥交换扩展。

这条原则能显著降低后续维护和上游升级成本。

---

## 20. 证书校验和身份语义还需要单独研究

Tongsuo 能装双证书，不等于 OpenVPN 的所有证书验证逻辑天然理解双证书。

OpenVPN 上游还有：

```text
ssl_verify_openssl.c
cert_verify_callback()
verify_cert()
peer certificate / username extraction
```

后续必须确认：

1. Tongsuo 暴露给 OpenVPN verification callback 的 peer certificate 是哪一张；
2. SIGN 与 ENC 两张证书的链验证分别在哪里发生；
3. OpenVPN 的 common name / X509 username 提取是否只基于 SIGN 证书；
4. ENC 证书的 Key Usage、证书链和身份绑定错误时是否能安全失败；
5. 双证书换成 HSM 时，证书对象和私钥对象是否仍保持一一对应。

这是“TLCP 能握手”到“产品身份认证语义正确”之间的一层独立工作。

---

## 21. HSM 后续接入点

从源码结构看，HSM 最好进入：

```text
OpenVPN 配置/凭据装载
        │
        ▼
Tongsuo Provider / ENGINE / PKCS#11 / OSSL_STORE
        │
        ▼
EVP_PKEY
        │
        ├─ SIGN slot -> EVP_DigestSign*
        └─ ENC  slot -> EVP_PKEY_decrypt*
```

不建议：

```text
ntls_statem_srvr.c
    直接写 vendor_hsm_sign()
```

原因是这会把设备实现散落进协议状态机，破坏密码后端抽象和后续升级能力。

---

## 22. 改造完成不能只看“握手成功”：验证闭环

### 22.1 编译期

确认：

```text
OpenVPN 实际链接的是目标 Tongsuo libssl/libcrypto
NTLS API feature detection 成功
没有误链接系统 OpenSSL
```

### 22.2 初始化期

至少覆盖负面测试：

```text
缺 SIGN cert
缺 SIGN key
缺 ENC cert
缺 ENC key
SIGN cert/key 不匹配
ENC cert/key 不匹配
SIGN/ENC 角色交换
错误 Key Usage
```

所有场景都应明确失败，不能静默回退。

### 22.3 状态机

通过断点/日志确认：

```text
ossl_statem_connect/accept
       ↓
state_machine_ntls
```

而不是普通 `state_machine()`。

### 22.4 抓包

至少确认：

```text
ClientHello/ServerHello 版本与协议语义
Cipher Suite wire ID
双 Certificate 行为
ServerKeyExchange
ClientKeyExchange
Finished
```

### 22.5 密码消费者

调试至少确认一次：

```text
SIGN EVP_PKEY -> EVP_DigestSign*
ENC public key -> EVP_PKEY_encrypt*
ENC private key -> EVP_PKEY_decrypt*
```

### 22.6 控制通道与数据通道分开验证

控制通道：

```text
TLCP + SM2/SM3/SM4 record
```

数据通道：

```text
实际 data cipher
实际 data key derivation
DCO/用户态数据面使用情况
```

两者必须分别给出证据。

---

## 23. 推荐的源码导航顺序

### 23.1 OpenVPN 上游 2.7.4

```bash
git checkout v2.7.4

git rev-parse HEAD

rg -n 'init_ssl\(' src/openvpn/ssl.c
rg -n 'tls_ctx_server_new|tls_ctx_client_new' src/openvpn
rg -n 'tls_ctx_set_tls_versions|tls_ctx_restrict_ciphers' src/openvpn/ssl_openssl.c
rg -n 'tls_ctx_load_cert_file|tls_ctx_load_priv_file' src/openvpn/ssl_openssl.c
rg -n 'key_state_ssl_init|key_state_export_keying_material' src/openvpn/ssl_openssl.c
rg -n 'generate_key_expansion|export_keying_material' src/openvpn
```

### 23.2 Tongsuo 8.4.0

```bash
git checkout a8ae0925d26de3b449f7a21767910cd41291bcd8

git rev-parse HEAD

rg -n 'NTLS_(server|client)_method' ssl
rg -n 'SSL_CTX_enable_ntls' ssl
rg -n 'state_machine_ntls' ssl/statem ssl/statem_ntls

rg -n 'SSL_PKEY_SM2_SIGN|SSL_PKEY_SM2_ENC' ssl
rg -n 'SSL_CTX_use_(sign|enc)_(certificate|PrivateKey)' ssl

rg -n 'tls_construct_server_key_exchange_ntls' ssl/statem_ntls
rg -n 'tls_construct_cke_pms_ntls|tls_process_cke_pms_ntls' ssl/statem_ntls

rg -n 'TLS1_PRF_SM3|SSL_kSM2|SSL_kSM2DHE' ssl
rg -n 'tls1_PRF|tls1_generate_master_secret|tls1_setup_key_block' ssl/t1_enc.c
rg -n 'ssl3_enc|tls1_mac' ssl/record
rg -n 'SSL_export_keying_material' ssl/ssl_lib.c
```

推荐阅读方式始终是：

```text
定义
→ 谁写
→ 对象状态变化
→ 谁读
→ 密码调用
→ 线上报文/失败现象
```

而不是从文件第一行顺序读到最后一行。

---

## 24. 最终改造点地图

| 层次 | 上游现状 | TLCP/国密候选改造 | 是否建议改协议状态机 |
|---|---|---|---|
| 构建 | 识别 OpenSSL 能力 | 增加 Tongsuo NTLS API feature detection | 否 |
| 配置 | 单 TLS 模式、单证书语义 | TLCP 模式 + SIGN/ENC 双凭据 | 否 |
| `SSL_CTX` 创建 | `SSLv23_*_method()` | 选择 `NTLS_*_method()` | 否 |
| 版本控制 | TLS 1.x 版本模型 | TLCP 模式绕开/适配 TLS 版本限制 | 否 |
| Cipher | 普通 TLS Cipher | 配置/限制 NTLS 国密套件 | 否 |
| 证书私钥 | 单 cert/key | 调 Tongsuo SIGN/ENC 专用 API | 否 |
| SSL/BIO | 通用 `SSL_new + Memory BIO` | 原则上复用 | 否 |
| TLCP 状态机 | OpenVPN 无实现 | 直接复用 Tongsuo | 原则上否 |
| SM2/SM3/SM4 | OpenVPN 不直接实现 | 复用 Tongsuo EVP/record | 原则上否 |
| Exporter | 假设标准 TLS exporter | 处理 NTLS exporter 语义与版本门禁 | 视接口方案而定 |
| OpenVPN 数据通道 | 独立 data cipher/key | 单独完成国密 cipher/key 协商闭环 | 不属于 TLCP 状态机 |
| HSM | OpenVPN 支持部分外部 key 抽象 | 通过 Provider/PKCS#11/ENGINE 保留 SIGN/ENC 角色 | 否 |

---

## 25. 结论

从未改造的 OpenVPN 2.7.4 和 Tongsuo 8.4.0 可以得到一个清晰结论：

```text
OpenVPN 的缺口主要在“TLCP 接入”
而不是“TLCP 协议实现”本身。
```

Tongsuo 已经拥有：

```text
NTLS method
→ TLCP state machine
→ 双证书
→ SM2 静态密钥传输 / SM2DHE 分支
→ SM3 PRF
→ SM4/HMAC-SM3 record
```

OpenVPN 上游需要研究和改造的是：

```text
配置表达
→ TLS backend 方法选择
→ 版本/套件策略
→ SIGN/ENC 双凭据装载
→ TLS API 边界
→ Exporter / 数据通道密钥接口
→ 验证与失败策略
```

最关键的架构原则是：

> **能在 OpenVPN TLS backend 和 Tongsuo 已有抽象层解决的问题，不进入 TLCP 状态机重写；能由 `EVP_PKEY/Provider` 解决的 HSM 问题，不把厂商 SDK 写进握手状态机；TLCP 控制通道和 OpenVPN 数据通道必须分别证明国密化。**

---

## 参考基线

- OpenVPN 2.7.4 release: https://github.com/OpenVPN/openvpn/releases/tag/v2.7.4
- OpenVPN 2.7.4 `ssl_openssl.c`: https://raw.githubusercontent.com/OpenVPN/openvpn/v2.7.4/src/openvpn/ssl_openssl.c
- Tongsuo 8.4.0 release: https://github.com/Tongsuo-Project/Tongsuo/releases
- Tongsuo NTLS 使用资料: https://github.com/Tongsuo-Project/Tongsuo/wiki/NTLS%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C
- GB/T 38636-2020《信息安全技术 传输层密码协议（TLCP）》
- GM/T 0024-2014《SSL VPN 技术规范》（历史/关联标准；具体项目采用标准版本应单独确认）
