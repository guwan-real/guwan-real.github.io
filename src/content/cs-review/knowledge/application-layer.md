---
knowledgeId: "application-layer"
moduleId: "networks"
title: "22. 应用层"
description: "应用层（国网 22；南网网络 2）"
order: 22
status: "handbook"
syllabusNumber: 22
source: "《电网招聘_计算机类_强化复习手册》第 22 节及专项 D4；对应国网 2027 大纲专业知识第 22 项。"
tags: ["应用层","国网2027","复习手册"]
---

## 原理与解题方法

**原理**：应用层定义具体业务消息格式与交互过程。

**怎么做**
- DNS 域名解析，常用 UDP/53，必要时 TCP/53；理解递归与迭代查询、缓存 TTL。
- HTTP 请求/响应与状态码：200 成功、301/302 重定向、400 客户端错误、401 未认证、403 禁止、404 未找到、500 服务端错误。
- HTTPS = HTTP over TLS，提供身份认证（依证书验证）、保密、完整性；TLS 握手与对称会话加密各司其职。
- DHCP 自动分配地址等参数，常见 DORA：Discover→Offer→Request→Ack。
- SMTP 发送邮件，POP3/IMAP 接收管理；FTP 控制/数据连接；SSH 加密远程登录。
- URL、URI、DNS 名与 IP 地址功能不同；HTTP 无状态 ≠ 应用无法实现会话（Cookie/Session/Token）。

**易错**：HTTPS 不是把 URL 隐藏得完全不可见；DNS 不是路由协议。

## 专项解题

### D4. HTTP/DNS/TLS 排障顺序

地址解析失败先看本地 DNS 解析；解析正确但 TCP 连接不上，查端口、路由、防火墙和服务监听；TCP 通但 HTTPS 失败，查 TLS 握手、证书域名/时间/信任链；TLS 成功但 HTTP 4xx/5xx，再查应用参数、权限、服务端逻辑。响应码 401 是需要身份认证，403 是拒绝授权，404 是资源不存在或不暴露。
