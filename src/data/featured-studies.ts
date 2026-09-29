const strongswan = 'https://github.com/strongswan/strongswan/blob/472dcd8bb50a91f156b725ff56992352b573f7dd/';
const linux = 'https://github.com/torvalds/linux/blob/v6.6/';
export const featuredStudies = [
  {
    id: 'strongswan-config-ike-sa', number: '01', question: '配置如何进入协议状态机？',
    observation: '连接加载输出、IKE 建立日志与双端 SA 记录可以相互核对；没有本次运行的调试调用栈。',
    sources: [
      { name: 'load_conn()', path: 'src/libcharon/plugins/vici/vici_config.c', line: 3018, url: strongswan + 'src/libcharon/plugins/vici/vici_config.c#L3018' },
      { name: 'initiate()', path: 'src/libcharon/plugins/vici/vici_control.c', line: 173, url: strongswan + 'src/libcharon/plugins/vici/vici_control.c#L173' },
      { name: 'checkout_by_config()', path: 'src/libcharon/sa/ike_sa_manager.c', line: 1517, url: strongswan + 'src/libcharon/sa/ike_sa_manager.c#L1517' },
    ],
  },
  {
    id: 'strongswan-child-sa-xfrm', number: '02', question: '协商结果怎样交给内核？',
    observation: 'CHILD_SA 的两条 SPI 与 XFRM state 一致，policy 保留 out / in / fwd 方向；没有 Netlink 抓取或安装失败注入记录。',
    sources: [
      { name: 'install()', path: 'src/libcharon/sa/child_sa.c', line: 1159, url: strongswan + 'src/libcharon/sa/child_sa.c#L1159' },
      { name: 'install_policies()', path: 'src/libcharon/sa/child_sa.c', line: 1485, url: strongswan + 'src/libcharon/sa/child_sa.c#L1485' },
      { name: 'add_sa()', path: 'src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c', line: 1736, url: strongswan + 'src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c#L1736' },
    ],
  },
  {
    id: 'strongswan-ip-packet-esp', number: '03', question: '业务包是否真的经过 ESP？',
    observation: 'PCAP 第 11、12 帧的双向 SPI 对应 XFRM state；ping 与 SA 计数记录了四次往返。PCAP 仅保存首对 ESP，没有内层抓包或内核调用跟踪。',
    sources: [
      { name: 'xfrm_output_one()', path: 'net/xfrm/xfrm_output.c', line: 490, url: linux + 'net/xfrm/xfrm_output.c#L490' },
      { name: 'esp_output()', path: 'net/ipv4/esp4.c', line: 654, url: linux + 'net/ipv4/esp4.c#L654' },
      { name: 'xfrm_input()', path: 'net/xfrm/xfrm_input.c', line: 447, url: linux + 'net/xfrm/xfrm_input.c#L447' },
    ],
  },
];
