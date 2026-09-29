---
title: "OpenVPN 2.7.4 总体框架与关键调用流程——国密改造底座源码地图"
description: "从总体框架和核心对象看 OpenVPN 的事件循环、双通道与 DCO。"
date: "2026-09-29"
updated: "2026-09-29"
category: "vpn"
modules: ["tls", "linux"]
editorial: "original"
tags: ["OpenVPN", "TLS", "OpenVPN 架构与方法"]
kind: "源码精读"
minutes: 45
featured: false
series: "OpenVPN 架构与方法"
seriesOrder: 1
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["OpenVPN 2.7.4；涉及 Tongsuo 时按正文指定版本"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "OpenVPN 2.7.4 总体框架与关键调用流程——国密改造底座源码地图", "mode": "原稿收录", "omissions": []}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。"}]
repository: "https://github.com/OpenVPN/openvpn/tree/v2.7.4"
basis: {"label": "OpenVPN 2.7.4 源码", "href": "https://github.com/OpenVPN/openvpn/tree/v2.7.4", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

> 文档定位：底座源码研究，不描述某一份本地 TLCP 补丁如何实现。  
> 研究基线：OpenVPN 2.7.4。官方发布 `v2.7.4` 对应提交 `8e9e91f`。  
> 研究目标：在进入 TLCP、Tongsuo、双证书、SM2/SM3/SM4 改造前，先建立 OpenVPN 自身的运行框架、目录职责、核心对象和主调用链。

---

## 1. 为什么要先看 OpenVPN 底座

OpenVPN 的国密化不是“把 OpenSSL 换成 Tongsuo”就结束。

对 OpenVPN 来说，至少存在两条彼此相关但不等价的安全链：

```text
控制通道
配置/证书
  ↓
TLS backend
  ↓
TLS/TLCP 握手
  ↓
认证 + 数据通道密钥材料协商

业务数据通道
TUN/TAP 明文包
  ↓
OpenVPN Data Channel
  ↓
独立 cipher / packet key
  ↓
UDP/TCP 网络包
```

【官方文档】OpenVPN 的 TLS 模式明确区分控制通道和数据通道：TLS 会话用于控制通道认证与交换数据通道密钥，而业务流量由独立的数据通道快速转发。

因此做 TLCP/国密研究时必须始终问两个问题：

1. TLCP 控制通道是否进入了 Tongsuo 并真正完成了 SM2/SM3/SM4 握手与记录保护？
2. OpenVPN 业务数据通道的 key derivation、cipher negotiation 和 packet crypto 是否也已经按目标国密方案闭环？

这也是为什么理解 `ssl.c` 还不够，还必须知道 `forward.c`、`crypto.c`、`ssl_ncp.c` 和 DCO 的位置。

---

## 2. 先建立一张总体图

OpenVPN 可以先按下面六层理解：

```text
┌─────────────────────────────────────────────┐
│ 1. 配置与生命周期                           │
│ openvpn.c / options*.c / init.c             │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 2. 事件循环与 I/O                           │
│ openvpn.c / forward.c / event.c             │
│ socket.c / tun.c                            │
└──────────────┬────────────────┬─────────────┘
               │                │
      Control Channel        Data Channel
               │                │
               ▼                ▼
┌──────────────────────┐  ┌──────────────────────┐
│ 3. TLS 控制通道      │  │ 4. 数据通道          │
│ ssl.c                │  │ crypto.c             │
│ reliable.c           │  │ ssl_ncp.c            │
│ ssl_backend.h        │  │ crypto_backend.h     │
│ ssl_openssl.c        │  │ crypto_openssl.c     │
└──────────┬───────────┘  └──────────┬───────────┘
           │                         │
           ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐
│ 5. OpenSSL/Tongsuo   │  │ 用户态 crypto / DCO │
│ TLS/TLCP 状态机      │  │ 内核数据通道         │
└──────────────────────┘  └──────────┬───────────┘
                                     │
                                     ▼
                            TUN/TAP ↔ 网络接口
```

这张图是后续所有源码阅读的“坐标系”。

---

## 3. 仓库目录怎么读

### 3.1 `src/openvpn/`：主程序核心

【源码确认】绝大多数与你做安全网关、TLS/TLCP、数据通道密码和运行时状态有关的代码都集中在这里。

不要按文件名从 A 到 Z 阅读，建议把它按职责分成下面几组。

#### A. 入口、配置与初始化

```text
openvpn.c
openvpn.h
options.c
options_parse.c
options.h
init.c
init.h
```

职责：

- `openvpn.c`：进程主循环，决定客户端走 point-to-point，服务端走 multi-server。
- `options*.c`：命令行和配置文件解析，把文本配置写入 `struct options`。
- `init.c`：把静态配置变成运行对象；初始化 socket、TUN/TAP、TLS、多路状态、crypto、路由等。
- `openvpn.h`：最重要的运行时总对象 `struct context` 及其分层状态。

【国密改造关注】  
如果未来 TLCP 要成为正式配置能力，最终必须从 `options`/配置模型进入，而不能长期停留在环境变量或测试开关中。

---

#### B. 主事件循环和报文转发

```text
forward.c
forward.h
event.c
event.h
socket.c
socket.h
tun.c
tun.h
```

职责：

- `forward.c` 是客户端/单隧道模式下“报文到底往哪走”的核心。
- `event.c` 封装 I/O 事件等待。
- `socket.c` 处理外部 UDP/TCP 链路。
- `tun.c` 处理内部 TUN/TAP 虚拟网卡。

理解 OpenVPN 时要建立两个方向：

```text
发送方向：
TUN/TAP → OpenVPN → UDP/TCP socket

接收方向：
UDP/TCP socket → OpenVPN → TUN/TAP
```

TLS 控制报文和业务数据报文都经过同一外部传输 socket，但在 OpenVPN 内部会被区分后进入不同处理链。

---

#### C. TLS 控制通道

```text
ssl.c
ssl.h
ssl_common.h
ssl_backend.h
ssl_openssl.c
ssl_mbedtls.c
ssl_verify.c
ssl_verify_openssl.c
reliable.c
ssl_pkt.c
tls_crypt.c
```

这一组是 TLCP 改造研究的主战场。

最重要的职责拆分：

- `ssl.c`：OpenVPN 自己的控制通道状态、TLS session 管理、Key Method、控制消息处理、数据通道 key state 管理。
- `ssl_backend.h`：OpenVPN 与具体 TLS 库之间的接口边界。
- `ssl_openssl.c`：OpenSSL 后端实现；创建 `SSL_CTX`、加载证书/私钥、创建 `SSL`/BIO、驱动握手、Exporter 等。
- `ssl_mbedtls.c`：mbedTLS 后端，可用于理解 OpenVPN 是如何隔离密码库差异的。
- `ssl_verify*.c`：对端证书验证。
- `reliable.c`：OpenVPN 控制通道自己的可靠传输层，特别是在 UDP 上保证控制消息可靠。
- `ssl_pkt.c`：TLS/control packet 辅助处理。
- `tls_crypt.c`：`tls-auth` / `tls-crypt` 等 TLS 外层保护，不等于 TLS/TLCP 记录层本身。

【国密改造关注】  
“接 Tongsuo/TLCP”应该优先从 `ssl_backend`/`ssl_openssl.c` 这一边界进入，而不是在 `forward.c` 或 OpenVPN 主事件循环里重写 TLCP 状态机。

---

#### D. 数据通道密码

```text
crypto.c
crypto.h
crypto_backend.h
crypto_openssl.c
crypto_mbedtls.c
ssl_ncp.c
ssl_ncp.h
crypto_epoch.c
```

职责：

- `crypto.c`：数据通道 packet encrypt/decrypt 的通用逻辑。
- `crypto_backend.h`：数据通道密码后端抽象。
- `crypto_openssl.c`：OpenSSL EVP 级 cipher/digest 实现。
- `ssl_ncp.c`：数据通道 cipher negotiation（NCP / `data-ciphers`）。
- `crypto_epoch.c`：2.7 中的数据 epoch/key 相关能力。

【国密改造关注】  
TLCP 控制通道改造成功后，如果目标还要求 OpenVPN 业务数据通道使用 SM4/SM3，这一组代码必须单独研究。不能用“TLS/TLCP cipher suite 是 SM4”替代对 OpenVPN Data Channel 的验证。

---

#### E. 多客户端服务端框架

```text
multi.c
multi.h
mudp.c
mtcp.c
multi_io.c
mroute.c
mbuf.c
```

职责：

OpenVPN server 同时维护多个客户端，每个客户端都需要独立 tunnel state、TLS state 和 data-channel keys。

高层对象关系：

```text
multi_context
   │
   ├── multi_instance A ── context A
   ├── multi_instance B ── context B
   └── multi_instance C ── context C
```

【官方源码文档】客户端通常只有一个 `context`；服务端通过 `multi_context` / `multi_instance` 管理多个客户端隧道。

【国密改造关注】  
如果你未来改 key lifecycle、证书状态或重协商逻辑，必须确认状态是“每进程共享”还是“每 client instance 独立”，避免把连接级状态错误地放进全局对象。

---

#### F. DCO：数据通道下沉

```text
dco.c
dco.h
dco_linux.c
dco_freebsd.c
dco_win.c
```

DCO（Data Channel Offload）把业务数据通道 packet crypto/forwarding 下沉到内核/驱动，用户态 OpenVPN 更接近控制面。

因此启用 DCO 后：

```text
控制通道：
仍主要由用户态 OpenVPN + TLS backend 处理

数据通道：
可能由内核 ovpn/DCO 路径直接处理
```

【国密改造关注】  
如果最终要求“数据面 SM4”，必须先确认目标部署是否启用 DCO。如果启用，单改 `crypto_openssl.c` 可能根本不覆盖真实数据包路径。

---

### 3.2 `src/plugins/`

OpenVPN 插件框架，主要用于认证、脚本/外部扩展等。

它不是 TLS/TLCP 状态机的主扩展点，也不是数据通道 cipher 的主要后端。

国密方案不要因为“这里叫 plugins”就误判为最合适的密码算法接入点。

---

### 3.3 `doc/`、`sample/`、`tests/`

这些目录不是运行核心，但非常适合源码研究：

- `doc/doxygen/`：官方源码架构说明。
- `sample/sample-config-files/`：理解配置入口。
- `tests/unit_tests/`：查找对象如何被构造、函数如何被独立调用。

研究某个函数时，除了 `rg 函数名 src/`，建议也搜 `tests/`。

---

## 4. OpenVPN 最重要的几个运行对象

### 4.1 `struct options`

来源：

```text
配置文件 / 命令行
       ↓
options_parse / parse_argv
       ↓
struct options
```

它保存“用户想要什么”。

例如：

- client/server 模式；
- remote/local；
- cert/key/ca；
- TLS version/cipher；
- data-ciphers；
- TUN/TAP；
- DCO；
- keepalive/renegotiation。

它不是连接运行状态本身。

---

### 4.2 `struct context`

OpenVPN 的主运行对象。

可以把它理解为：

```text
context
├── options        静态配置
├── c1             生命周期较长的一级状态
└── c2             当前连接/运行循环状态
```

【官方源码文档】在 client 模式中，一个 `context` 基本对应当前单个 VPN tunnel；server 模式中，每个 client tunnel 有自己的 `context`，由 multi 框架管理。

研究日志、断点和变量时，`context *c` 是最常见的入口。

---

### 4.3 `tls_root_ctx`

这是 OpenVPN 对 TLS library context 的包装。

OpenSSL backend 下内部最终持有 `SSL_CTX *`。

生命周期：

```text
OpenVPN 配置
   ↓
init_ssl()
   ↓
tls_root_ctx
   ↓
tls_ctx_server_new()/tls_ctx_client_new()
   ↓
SSL_CTX
```

【国密改造关注】  
TLCP method、双证书、版本边界、Tongsuo Provider/ENGINE 等都与这一级密切相关。

---

### 4.4 `tls_multi → tls_session → key_state`

这是 OpenVPN TLS 控制通道最重要的对象链。

粗略理解：

```text
tls_multi
│  一个 VPN tunnel 的 TLS/数据密钥总体状态
│
├── tls_session
│      TLS session / negotiation 生命周期
│
└── key_state
       某一代可用或正在建立的 key state
       ├── key_state_ssl
       └── data channel crypto options
```

官方 Doxygen 明确说明：

- `tls_multi_init()` 初始化一个 tunnel 的 TLS 总体状态；
- `tls_multi_process()` 遍历其中的 TLS sessions；
- `tls_process()` 处理具体 control-channel TLS session；
- `key_method_2_*()` 负责数据通道密钥材料交换。

这组对象是理解“TLS/TLCP 握手完成以后为什么还能继续建立/轮换 OpenVPN Data Channel keys”的关键。

---

### 4.5 `crypto_options` / `key_ctx_bi`

业务数据通道最后并不是直接拿 `SSL *` 加密。

数据 packet 使用独立对象：

```text
crypto_options
  ↓
key_ctx_bi
  ├── encrypt
  └── decrypt
```

这再次说明：

```text
TLS/TLCP record key
≠
OpenVPN data channel packet key
```

---

## 5. 程序启动主流程

### 5.1 进程级入口

核心函数：

```text
src/openvpn/openvpn.c
openvpn_main()
```

官方源码文档把它描述为 OpenVPN 的 init-run-cleanup 主循环。

高层流程：

```text
openvpn_main()
   │
   ├─ init early/runtime library
   ├─ parse_argv()
   ├─ options_postprocess()
   ├─ management/plugins
   │
   └─ 根据 mode
        ├─ tunnel_point_to_point()
        └─ tunnel_server()
```

这里先完成“程序是什么模式、配置是什么”，然后才进入某个 VPN tunnel 的真正初始化和事件循环。

---

### 5.2 tunnel 初始化

重要文件：

```text
src/openvpn/init.c
```

核心入口：

```text
init_instance()
```

它的作用不是只初始化 TLS，而是把一个 OpenVPN tunnel 所需的主要运行对象全部建立起来。

研究时重点向下追：

```text
init_instance()
   ↓
do_init_crypto()
   ↓
do_init_crypto_tls()
   ↓
TLS root / tls_multi / frame / data cipher
```

同时还会建立 socket、TUN/TAP、route 等运行环境。

【国密改造关注】  
`init.c` 是理解“某一项 TLS/crypto 配置在什么时候真正变成运行对象”的最佳入口之一。

---

## 6. 客户端主事件循环

核心入口：

```text
openvpn.c
tunnel_point_to_point()
```

主循环非常值得记住：

```text
while (...)
{
    pre_select();   // timers、TLS、重协商、控制面工作
    io_wait();      // 等 TUN 或网络 socket 事件
    process_io();   // 处理实际 I/O
}
```

这比背几十个函数重要。

它说明 OpenVPN 是事件驱动程序，而不是：

```text
先完成所有TLS
→ 再永久进入数据转发
```

实际上 TLS 重协商、keepalive、控制消息和数据包处理长期共存于事件循环中。

---

## 7. `process_io()`：报文主分叉点

文件：

```text
src/openvpn/forward.c
```

核心函数：

```text
process_io()
```

可以先记成：

```text
事件来自外部 socket？
    ↓
process_incoming_link()

事件来自 TUN/TAP？
    ↓
process_incoming_tun()
```

于是所有数据流可以从这里往两个方向追。

---

## 8. 收到网络报文：控制包和数据包在哪里分开

主链：

```text
socket
  ↓
read_incoming_link()
  ↓
process_incoming_link()
  ↓
tls_pre_decrypt()
```

`tls_pre_decrypt()` 是非常关键的边界。

它要判断当前收到的是：

```text
OpenVPN Control Channel packet
还是
OpenVPN Data Channel packet
```

### 控制通道

控制报文进入：

```text
reliable layer
   ↓
TLS control processing
   ↓
tls_multi_process()
   ↓
tls_process()
   ↓
TLS backend / SSL object
```

### 数据通道

数据报文取得当前 `crypto_options` 后进入：

```text
openvpn_decrypt()
   ↓
解密/认证成功
   ↓
写入 TUN/TAP
```

【国密改造关注】  
抓包看到 TLCP 握手包只证明 control path；业务 P_DATA 报文最终仍由 `openvpn_decrypt()` 或 DCO 等数据面消费者处理。

---

## 9. 发出业务数据包：TUN 到网络

主链：

```text
TUN/TAP
   ↓
process_incoming_tun()
   ↓
encrypt_sign()
   ↓
tls_pre_encrypt()
   ↓
openvpn_encrypt()
   ↓
process_outgoing_link()
   ↓
UDP/TCP socket
```

关键含义：

### `tls_pre_encrypt()`

不是执行 TLS 加密。

它主要从 `tls_multi/key_state` 中选择**当前应该用于数据通道的 key/crypto_options**。

### `openvpn_encrypt()`

真正执行 OpenVPN 用户态 data channel packet cipher/auth。

官方源码文档明确将 `openvpn_encrypt()` / `openvpn_decrypt()` 定义为 Data Channel Crypto 模块。

【国密改造关注】  
如果最终要求 P_DATA 使用 SM4，这条链比 Tongsuo `ssl/record/` 更重要。

---

## 10. TLS 控制通道主流程

### 10.1 TLS 上下文建立

OpenVPN 通用入口：

```text
ssl.c
init_ssl()
```

然后通过 backend：

```text
ssl_backend.h
    ↓
ssl_openssl.c
    ├─ tls_ctx_server_new()
    └─ tls_ctx_client_new()
```

上游 OpenVPN/OpenSSL 后端创建的是正常 TLS `SSL_CTX`。

证书、私钥、CA、版本和 cipher 等随后继续写入这个 context。

这正是 TLCP 改造最自然的接入层。

---

### 10.2 tunnel TLS 状态建立

```text
do_init_crypto_tls()
   ↓
tls_multi_init()
   ↓
tls_multi_init_finalize()
   ↓
tls_session / key_state
```

当某个 key state 真正需要 TLS 连接时：

```text
key_state_ssl_init()
   ↓
SSL_new()
   ↓
Memory BIO
```

Memory BIO 很重要：

OpenVPN 并不让 TLS library 自己直接操作网络 socket。

而是：

```text
OpenVPN 收到 control bytes
      ↓
写入 BIO
      ↓
TLS/TLCP library 处理

TLS/TLCP library 产生 bytes
      ↓
从 BIO 读出
      ↓
OpenVPN reliable/control channel 发送
```

这就是为什么 OpenVPN 可以保留自己的 packet/reliability 框架，而把 TLS/TLCP 状态机交给 OpenSSL/Tongsuo。

---

### 10.3 TLS session 被谁持续驱动

```text
pre_select()/timer
    ↓
check_tls()
    ↓
tls_multi_process()
    ↓
tls_process()
```

`tls_process()` 才是 control-channel processor 的核心处理函数之一。

它会结合：

- TLS/BIO 输入输出；
- reliable buffers；
- Key Method 消息；
- session/key-state 状态；
- 重协商和失效；

持续推动一条 tunnel 的控制状态。

【国密改造关注】  
OpenVPN 不需要重新实现 TLCP ClientHello/ServerHello 状态机。合适的设计是让 `tls_process()` 继续按原框架驱动 backend，而 backend 里的 Tongsuo `SSL` 运行 NTLS 状态机。

---

## 11. 数据通道密钥为什么来自 TLS，但又不等于 TLS record key

这是 OpenVPN 架构中最容易误解的点。

TLS 模式下，控制通道的安全会话负责安全地建立/交换 OpenVPN 自己的数据通道密钥材料。

OpenVPN 仍然有：

```text
Key Method
key_source
key_source2
key_state
key2
crypto_options
```

因此可以形成：

```text
TLS/TLCP 握手和认证
       ↓
获得安全的控制通道/导出密钥能力
       ↓
OpenVPN Key Method 2
       ↓
OpenVPN Data Channel keys
       ↓
openvpn_encrypt()/decrypt()
```

在支持 TLS Exporter 的模式下，OpenVPN 可以利用 Exporter 参与数据通道密钥派生；在 legacy 路径中还有 OpenVPN 自己的 PRF/key source 机制。

【国密改造关注】  
研究 TLCP 时必须单独确认 Exporter 是否能工作，以及 Data Channel key derivation 最终走哪条分支。

---

## 12. 数据通道 cipher negotiation

文件：

```text
ssl_ncp.c
ssl_ncp.h
```

OpenVPN 2.x 的数据通道 cipher 可以通过 `data-ciphers` 在 peers 之间协商。

高层逻辑：

```text
本地 data-ciphers
      +
对端 peer info / cipher list
      ↓
选择共同支持 cipher
      ↓
建立 data-channel key type/context
```

这和 TLS/TLCP Cipher Suite 是两个命名空间、两条协商链。

因此：

```text
TLCP: ECC-SM2-SM4-CBC-SM3
```

不能自动推出：

```text
OpenVPN data-ciphers 中已经选择 SM4
```

---

## 13. 服务端模式：为什么还要读 `multi.c`

客户端阅读 `openvpn.c + forward.c` 很容易建立直觉。

服务端必须多看一层：

```text
openvpn.c
   ↓
tunnel_server()
   ↓
multi_context
   ↓
multi_instance
   ↓
每个 client 的 context
```

每个客户端都有自己的：

- TLS session；
- key state；
- peer info；
- data channel keys；
- virtual address / routes；
- timers。

【国密改造关注】  
双证书的 server `SSL_CTX` 可以是根上下文级配置，但握手 session 和 PMS/master/key state 必须是连接级状态，不能因为服务端共享根 context 就错误共享密钥材料。

---

## 14. DCO 对国密研究的影响

官方 DCO 文档的核心结论：

> 使用 DCO 时，业务数据包可直接在内核空间处理，OpenVPN 用户态主要承担控制面。

所以要先判断目标产品：

```text
是否启用 DCO？
```

若否：

```text
forward.c
 → crypto.c
 → crypto backend
```

是主要业务数据面。

若是：

```text
OpenVPN userspace
  ↓ 配置 key/peer
DCO/kernel
  ↓
真实 data packet crypto
```

国密数据面改造点可能完全不同。

---

## 15. OpenVPN 的“框架边界”到底在哪里

### 边界 1：OpenVPN ↔ TLS Library

```text
ssl_backend.h
ssl_openssl.c
```

这是 TLCP/Tongsuo 最优先研究的边界。

---

### 边界 2：控制通道 ↔ 数据通道

```text
ssl.c
tls_multi / key_state
```

这里决定“TLS 建立以后，OpenVPN 数据 key 怎么产生、什么时候生效”。

---

### 边界 3：OpenVPN 通用 data crypto ↔ 密码库

```text
crypto_backend.h
crypto_openssl.c
```

这里决定业务数据 cipher 能否由某密码库/Provider 提供。

---

### 边界 4：用户态 ↔ DCO 内核数据面

```text
dco*.c
```

这里决定实际业务包是否还经过用户态 `openvpn_encrypt()`。

---

## 16. 对国密改造最重要的底座结论

### 结论一：不要重写 OpenVPN 的整个控制框架

应该尽量保持：

```text
reliable
tls_multi
tls_session
key_state
Memory BIO
```

不变，把 TLCP 接入 TLS backend。

---

### 结论二：Tongsuo 负责 TLCP 状态机，不代表 OpenVPN 数据通道自然国密化

必须分别验证：

```text
Control Channel
TLCP / SM2 / SM3 / SM4

Data Channel
OpenVPN packet cipher / key derivation / DCO
```

---

### 结论三：正式产品最终必须进入配置模型

研究 PoC 可以用环境变量或编译宏快速验证。

产品化最终应该形成：

```text
options
  ↓
tls_options / tls_root_ctx
  ↓
backend
```

的可审计配置链。

---

### 结论四：读 OpenVPN 源码最重要的是“对象生命周期”

优先理解：

```text
options
  ↓
context
  ↓
tls_root_ctx
  ↓
tls_multi
  ↓
tls_session
  ↓
key_state
  ↓
crypto_options
```

再去读具体 cipher API，效率最高。

---

## 17. 推荐源码阅读顺序

不要从 `src/openvpn/` 第一行开始。

建议按下面顺序：

```text
1. openvpn.c
   openvpn_main()
   tunnel_point_to_point()
   tunnel_server()

2. init.c
   init_instance()
   do_init_crypto_tls()

3. openvpn.h
   struct context

4. forward.c
   process_io()
   process_incoming_link()
   process_incoming_tun()
   encrypt_sign()

5. ssl.c / ssl.h
   init_ssl()
   tls_multi_init()
   tls_multi_process()
   tls_process()
   tls_pre_decrypt()
   tls_pre_encrypt()

6. ssl_backend.h
   理解 TLS backend 边界

7. ssl_openssl.c
   SSL_CTX / SSL / BIO / Exporter

8. crypto.c / crypto_backend.h / crypto_openssl.c
   Data Channel packet crypto

9. ssl_ncp.c
   Data Channel cipher negotiation

10. multi.c
    server 多客户端

11. dco*.c
    内核数据面
```

完成这 11 步后，再进入 Tongsuo `ssl/` 源码会非常清楚。

---

## 18. 只读源码导航命令

```bash
# 进程入口与事件循环
rg -n 'openvpn_main|tunnel_point_to_point|tunnel_server' src/openvpn

# tunnel 初始化
rg -n 'init_instance|do_init_crypto_tls' src/openvpn/init.c

# 控制通道
rg -n 'init_ssl|tls_multi_init|tls_multi_process|tls_process' src/openvpn/ssl.c

# 收发分流
rg -n 'process_io|process_incoming_link|process_incoming_tun|encrypt_sign' \
  src/openvpn/forward.c

# 控制/数据 packet 分流与 key 选择
rg -n 'tls_pre_decrypt|tls_pre_encrypt' src/openvpn/ssl.c

# TLS backend
rg -n 'tls_ctx_server_new|tls_ctx_client_new|key_state_ssl_init|export_keying' \
  src/openvpn/ssl_openssl.c src/openvpn/ssl_backend.h

# 数据通道 crypto
rg -n 'openvpn_encrypt|openvpn_decrypt' src/openvpn/crypto.c

# cipher negotiation
rg -n 'data-ciphers|NCP|ncp|cipher' src/openvpn/ssl_ncp.c src/openvpn/options*

# DCO
rg -n 'dco_' src/openvpn/dco*.c src/openvpn/init.c
```

---

## 19. 后续与 TLCP/Tongsuo 文档怎么衔接

本底座文档只把入口定位到：

```text
OpenVPN
ssl_backend.h
   ↓
ssl_openssl.c
   ↓
SSL_CTX / SSL / BIO
```

后续《OpenVPN→Tongsuo 双证书与密钥生命周期附录》再继续：

```text
SSL_CTX
  ↓
NTLS method
  ↓
SIGN/ENC 双证书
  ↓
Tongsuo state_machine_ntls
  ↓
ServerKeyExchange / ClientKeyExchange
  ↓
PMS
  ↓
Master Secret / Key Block
  ↓
TLCP Record
```

而 OpenVPN Data Channel 则返回本文件中的：

```text
ssl.c
→ ssl_ncp.c
→ crypto.c
→ crypto backend / DCO
```

两份文档合起来才是完整国密研究视角。

---

## 20. 一句话总结

OpenVPN 的核心不是“TLS 程序”，而是一个事件驱动 VPN 框架：

```text
配置与生命周期
→ context
→ event loop
→ control/data 分流
→ TLS backend 负责安全控制通道
→ tls_multi/key_state 管理密钥代际
→ 独立 Data Channel 负责业务包
→ socket/TUN 或 DCO 完成真实转发
```

国密改造最合理的策略，是保留这套框架，在**TLS backend、证书/密钥生命周期、Data Channel crypto/KDF，以及必要的 DCO 数据面边界**上有控制地扩展，而不是重新实现 OpenVPN 主流程。

---

## 参考依据

### 源码

- `OpenVPN/openvpn`，版本 `v2.7.4`
- 重点目录：`src/openvpn/`
- 本项目已有 OpenVPN 2.7.4 源码快照用于函数位置交叉核对

### 官方资料

- OpenVPN 2.7 Manual
- OpenVPN Source Code Documentation / Doxygen
- Main Event Loop module
- Control Channel Processor module
- Data Channel Control / Data Channel Crypto modules
- Tunnel state storage documentation
- OpenVPN Data Channel Offload documentation

> 注：本文件以“文件 + 函数 + 对象关系”为稳定源码锚点。精确行号应在最终公司锁定的上游提交/采购源码版本上重新生成，避免本地补丁造成行号漂移。
