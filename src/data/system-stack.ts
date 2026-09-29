/** Technical modules selected from the author's complete system-stack diagram.
 * Preserve its 01–13 numbering. This is a subject map, not a packet execution sequence.
 */
export const stack = [
  {id:'product',no:'01',title:'产品 / 业务',english:'APPLICATIONS',group:'system',brief:'IPsec VPN · SSL VPN · ZTNA · 安全认证',scope:[['VPN','Site-to-site / Remote VPN / Remote Access'],['业务扩展','SD-WAN / Multi-WAN / Overlay / 动态选路'],['安全平台','Secure Edge / SASE / 云边统一安全']],articles:[]},
  {id:'management',no:'02',title:'管理面 / 产品工程',english:'MANAGEMENT',group:'system',brief:'Web / CLI / API · 配置 · 运维',scope:[['入口','Web / CLI / REST API'],['用户与权限','用户管理 / RBAC / 三员管理 / MFA / SSO'],['配置','VPN / 证书 / 路由与 NAT / Crypto 策略 / PQC 策略'],['运维','日志 / 审计 / 告警 / 状态监控 / 升级与回滚 / HA 与备份'],['工程链','前端 → API → 后端 → DB → 系统服务']],articles:[]},
  {id:'control',no:'03',title:'统一控制面',english:'CONTROL PLANE',group:'system',brief:'Identity · Policy · Crypto Agility',scope:[['职责','Identity / Policy / Capability Discovery'],['密码敏捷','prefer / allow / require / 算法版本 / 对端能力发现'],['变更控制','升级 / 灰度 / 回滚 / 防降级'],['策略','传统 / 国密 / PQC / Hybrid']],articles:[]},
  {id:'ipsec',no:'04',title:'VPN / 安全协议控制面',english:'IPSEC / IKE',group:'protocol',brief:'IKEv1 / IKEv2 · Proposal · SA',scope:[['IKEv1','Main Mode / Aggressive Mode / Quick Mode'],['IKEv2','IKE_SA_INIT / IKE_AUTH / CREATE_CHILD_SA / INFORMATIONAL'],['协商与密钥','Proposal → Transform → KE / Nonce → AUTH / Certificate → KDF'],['状态','IKE SA / CHILD SA / Rekey / DPD / NAT-T / Fragment']],articles:['strongswan-key-derivation','strongswan-child-sa-xfrm']},
  {id:'tls',no:'05',title:'TLS / PKI 体系',english:'TLS / TLCP / PKI',group:'protocol',brief:'握手 · Record · 证书 · SSL VPN',scope:[['协议','TLS 1.2 / TLS 1.3 / TLCP'],['握手','ClientHello / ServerHello / Certificate / CertificateVerify / Finished'],['会话','Record Layer / Session Resume'],['PKI','CA / Intermediate CA / X.509 / CSR / CRL / OCSP / SAN / KU / EKU / 双证书'],['SSL VPN','用户认证 / 隧道 / 地址与路由下发 / 资源授权 / 反向代理 / TLS 卸载']],articles:['openvpn-data-channel-keys','tls-openvpn-data-channel']},
  {id:'crypto',no:'06',title:'密码工程',english:'CRYPTOGRAPHIC ENGINEERING',group:'protocol',brief:'SM2 / SM3 / SM4 · KE / KEM · KDF',scope:[['传统与国密','SM2 / SM3 / SM4 / ECDH / DH'],['后量子','ML-KEM / ML-DSA / Hybrid'],['混合密钥交换','ECDH / SM2 + PQC KEM → Shared Secret → KDF → Session / SA Keys'],['接入链','算法注册 → Proposal / Cipher Suite → 协商 → KE / KEM → KDF → 协议状态机']],articles:['strongswan-key-derivation','openvpn-data-channel-keys']},
  {id:'provider',no:'07',title:'统一密码抽象 / Provider',english:'CRYPTO ABSTRACTION',group:'protocol',brief:'OpenSSL · Tongsuo · SDF / SKF · HSM',scope:[['统一接口','IPsec / TLS / TLCP → Unified Crypto API'],['软件与设备接口','OpenSSL Provider / ENGINE / Tongsuo Provider / SDF / SKF / PKCS#11 / HSM API / Vendor SDK'],['适配','Crypto Adapter → 软件密码库 / 密码板卡 / HSM / UKey'],['设计目标','更换算法、板卡或增加 PQC 时，通过注册和适配控制对协议主体的影响']],articles:[]},
  {id:'xfrm',no:'08',title:'IPsec 数据面',english:'XFRM / ESP',group:'kernel',brief:'Netlink · State / Policy · ESP',scope:[['控制面到内核','IKE → Netlink → Linux XFRM State / Policy → ESP Data Plane'],['逐包处理','SA Lookup / Encrypt / Integrity / Anti-Replay / Sequence No / Encapsulation / NIC']],articles:['strongswan-child-sa-xfrm']},
  {id:'linux',no:'09',title:'Linux 网络系统',english:'KERNEL NETWORKING',group:'kernel',brief:'skb · 路由 · Netfilter · NAPI · TUN',scope:[['边界','User Space / Socket / Syscall / Kernel Space'],['网络栈','skb / TCP / UDP / IP / Routing / Netfilter / Conntrack / XFRM / Driver / NAPI / NIC'],['网络环境','Namespace / Bridge / VLAN / VRF / nftables / iptables / tc / netem / Routing Table'],['系统机制','systemd / Process / Thread / mmap / epoll / Signal / Synchronization']],articles:['linux-packet-path','tun-packet-path','tls-openvpn-data-channel']},
  {id:'platform',no:'10',title:'操作系统适配',english:'PLATFORM ENGINEERING',group:'kernel',brief:'Linux / Windows · 内核 · 驱动 · 构建',scope:[['Linux','麒麟 / 统信 / Ubuntu / CentOS / RHEL / ARM / x86'],['系统依赖','内核版本 / libc / OpenSSL / Tongsuo / systemd / Kernel Module / XFRM / 网卡驱动'],['Windows','VPN Adapter / WFP / Routing / Certificate Store / Driver / Installer / Compatibility']],articles:[]},
  {id:'performance',no:'11',title:'性能工程',english:'BENCHMARK / PROFILING',group:'performance',brief:'CPS / PPS / Gbps · 时延 · perf',scope:[['测量','Benchmark → Profiling → Control Plane / Crypto Bottleneck / Data Plane'],['指标','IKE CPS / Handshake Latency / Concurrent SA / Rekey / PPS / Gbps / Latency'],['定位','perf / Flamegraph / Counters / Lock Contention / Memory Allocation / Crypto Overhead / memcpy / Context Switch / Cache Miss'],['优化','Object Pool / Batching / Async Crypto / Thread Pool / Lock Reduction / Per-core SA / CPU Affinity / Zero-copy']],articles:['vpn-performance-profile']},
  {id:'fast-path',no:'12',title:'高性能网络 / Fast Path',english:'AF_XDP / DPDK',group:'performance',brief:'多队列 · NUMA · AF_XDP / DPDK · 卸载',scope:[['网络扩展','RSS / RPS / XPS / Multi Queue / CPU Affinity / NUMA / Cache / Zero Copy'],['高速路径','AF_XDP / DPDK'],['DPDK','EAL / PMD / mbuf / mempool / ring / batching / crypto-dev / IPsec-secgw'],['硬件卸载','NIC Offload / FPGA / Crypto Card'],['原图中的进入顺序','普通 Linux 网络 → XFRM → Profiling → Multi-core / NUMA → AF_XDP / DPDK']],articles:['vpn-performance-profile']},
  {id:'rdma',no:'13',title:'RDMA',english:'HIGH-PERFORMANCE BRANCH',group:'performance',brief:'Verbs · Queue Pair · MR · RoCE / IB',scope:[['机制','Verbs / Queue Pair / Send / Receive / Memory Region / Registered Memory / Zero Copy / DMA'],['网络','RoCE / InfiniBand'],['场景','高性能密码服务集群 / HSM 集群 / GPU 与 FPGA 远程计算 / 数据中心低时延通信']],articles:[]},
];
export const crossSections = [
  {id:'pqc',title:'PQC 迁移',subtitle:'跨协议与密码实现',terms:['Crypto Inventory → Threat Assessment → Migration Policy','Classical / Hybrid / PQC → Crypto Agility','IKE / TLS / TLCP / PKI → 灰度部署 / 回滚'],links:['control','crypto','provider']},
  {id:'network-conditions',title:'特殊网络场景',subtitle:'跨控制面与数据面',terms:['高 RTT / 抖动 / 丢包 / 断链 / MTU 敏感','IKE Fragmentation / Retransmission / SA 恢复','PQC 大公钥与密文 / Path MTU / Timer / Reconnect / Mobility'],links:['ipsec','tls','linux']},
  {id:'languages',title:'编程与自动化',subtitle:'贯穿各层的工程工具',terms:['C → Linux 底层 / 内核','C++ → VPN / 网关 / 系统服务','Python / Shell / Go → 自动化 / 测试 / Benchmark / 运维'],links:['linux','performance']},
  {id:'toolchain',title:'调试与工程工具链',subtitle:'观测、复现与交付',terms:['Wireshark / tcpdump → 网络协议','gdb / strace / perf / Flamegraph → 系统与性能','iproute2 / nft / iptables / tc / netem → 网络环境','Git / CI / CMake / Build System / Unit / Integration / Fuzz / ASan'],links:['ipsec','linux','performance']},
];

/** Each path is a bounded explanation, not a complete protocol trace. */
export const flows = [
 {id:'ike',name:'IKE → 内核 SA',kind:'控制面交接',boundary:'示意普通 IKEv2 初始建链的职责交接；多重 KE、EAP 和重协商需要展开各自流程。',steps:[
  {module:'management',label:'连接配置',output:'VICI / swanctl',note:'配置定义身份、Proposal 与 Traffic Selector；加载成功不等于连接已经建立。'},
  {module:'ipsec',label:'IKE 初始交换',output:'Proposal / KE / Nonce',note:'IKE_SA_INIT 协商参数并交换 KE 与 Nonce；身份认证还没有完成。'},
  {module:'crypto',label:'IKE 密钥派生',output:'keymat → IKE keys',note:'初始共享秘密按 IKEv2 规则进入 KDF，产生保护后续交换及认证所需的密钥材料。'},
  {module:'ipsec',label:'认证与首个 CHILD',output:'IKE_AUTH / CHILD keys',note:'在受保护的 IKE_AUTH 中认证身份并协商首个 CHILD_SA；keymat 再派生 CHILD 方向密钥。'},
  {module:'xfrm',label:'安装 SA 与策略',output:'Netlink → state / policy',note:'kernel-netlink 把 CHILD_SA 交给 Linux。业务是否受保护，还要观察策略命中、ESP 与计数。'},
 ]},
 {id:'esp',name:'业务包 → ESP',kind:'出站数据路径',boundary:'这里展示 Linux 内核 XFRM 的出站处理。用户态 ESP 与硬件卸载需要分别核对。',steps:[
  {module:'linux',label:'明文业务包',output:'Socket / 转发 → 路由',note:'包可能来自本机，也可能来自转发入口；先确定方向、路由和匹配范围。'},
  {module:'xfrm',label:'策略与 SA',output:'policy lookup → state',note:'XFRM 找到需要的保护策略与对应 SA；IKE 守护进程不逐包转发这段业务。'},
  {module:'xfrm',label:'ESP 处理',output:'序列号 / 加密 / 封装',note:'出站 SA 驱动序列号和密码处理。对端入站还要执行认证、防重放和策略检查。'},
  {module:'linux',label:'外层发包',output:'队列 → 驱动 → NIC',note:'外层 IP/ESP 或 NAT-T 包进入发送路径；定位瓶颈时再看队列、CPU 与驱动统计。'},
 ]},
 {id:'openvpn',name:'TUN → OpenVPN',kind:'用户态数据路径',boundary:'此处是用户态数据通道发送路径；TLS 控制通道提供密钥基础，业务包不是逐个进入 TLS Record。DCO 是另一分支。',steps:[
  {module:'linux',label:'从 TUN 读包',output:'read_incoming_tun',note:'路由送入 TUN 的业务 IP 包成为用户态输入；先检查接口方向与包边界。'},
  {module:'tls',label:'选择数据密钥',output:'encrypt_sign / key state',note:'OpenVPN 的数据路径选择可用 key state，控制通道与业务通道在此处保持分工。'},
  {module:'crypto',label:'数据通道加密',output:'AEAD / cipher + HMAC',note:'使用数据通道方向密钥完成保护；TLS/TLCP 控制密钥不能与这组密钥混为一谈。'},
  {module:'linux',label:'外层 Socket',output:'process_outgoing_link',note:'封装后的外层包写入 UDP/TCP Socket，再由内核发送。切到 DCO 后需要另查真实运行路径。'},
 ]},
 {id:'pqc',name:'PQC 接入边界',kind:'能力依赖关系',boundary:'这是一组必须闭合的接口，不是可随意替换的通用 KEM 握手；线上交换与 KDF 组合遵循具体协议。',steps:[
  {module:'control',label:'算法与回退策略',output:'允许 / 要求 / 禁止降级',note:'策略规定必须满足的安全条件；能力不足时是否回退需要显式决策。'},
  {module:'ipsec',label:'线上交换',output:'Transform / 额外 KE',note:'对端必须理解相同的协议表达、消息顺序与交换语义，不能只在本机注册算法。'},
  {module:'provider',label:'实际算法实现',output:'软件 / Provider / 设备',note:'检查创建对象、执行运算、错误与设备状态；加载成功并不证明运算真的走了目标实现。'},
  {module:'crypto',label:'秘密进入 KDF',output:'共享秘密 → 协议密钥',note:'确认真实输出被状态机消费并参与协议规定的派生；然后另查 CHILD_SA 与业务数据面。'},
 ]},
];
