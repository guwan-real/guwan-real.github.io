---
knowledgeId: db-security
description: 区分认证、授权、完整性和审计，并用角色、视图、加密与参数化查询组合保护数据库。
updatedAt: "2026-10-28"
sources:
  - label: PostgreSQL 18 官方文档：数据库角色
    url: https://www.postgresql.org/docs/18/user-manag.html
  - label: PostgreSQL 18 官方文档：对象权限
    url: https://www.postgresql.org/docs/18/ddl-priv.html
  - label: PostgreSQL 18 官方文档：行安全策略
    url: https://www.postgresql.org/docs/18/ddl-rowsecurity.html
  - label: PostgreSQL 18 官方文档：加密选项
    url: https://www.postgresql.org/docs/18/encryption-options.html
  - label: PostgreSQL 18 官方文档：CREATE VIEW
    url: https://www.postgresql.org/docs/18/sql-createview.html
  - label: OWASP：SQL 注入防护
    url: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
  - label: OWASP：数据库安全
    url: https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html
  - label: OWASP：日志记录
    url: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
  - label: PostgreSQL 18 官方文档：REVOKE
    url: https://www.postgresql.org/docs/18/sql-revoke.html
  - label: Microsoft SQL Server 官方文档：创建数据库用户
    url: https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/create-a-database-user?view=sql-server-ver15
---

## 数据库安全具体在保护什么

沿用借阅系统：Reader 表里有姓名和电话，Loan 表里有借阅历史。系统既要让工作人员完成登记，也不能让普通报表账号看到所有电话、任意修改借阅记录。

可以从三个目标理解：**机密性**防止未授权读取，**完整性**防止不当篡改，**可用性**让授权业务在需要时可用。它们往往需要组合措施：限制账号权限无法代替备份，备份也无法阻止某个账号今天越权读数据。

本章使用自编账号和表名说明原理。判断措施时先明确“要防止哪一种失败”，不要看到加密、角色、日志就认为它们可以相互替代。

## 认证、授权、完整性、审计要分开

| 机制 | 回答的问题 | 借阅例子 |
| --- | --- | --- |
| 身份认证 | 你是谁，凭什么证明 | 登录凭据是否有效 |
| 访问授权 | 这个身份能对什么做什么 | 报表账号可读汇总，不能修改借阅 |
| 完整性约束 | 写入的数据是否符合规则 | 外键有效，归还时间不早于借出时间 |
| 审计 | 谁在何时执行了什么，结果怎样 | 记录谁批量导出了读者信息 |

认证成功不等于拥有所有权限；某次写入数值符合范围，也不等于该用户有权写入。审计可以支持追踪和发现问题，但单纯记录日志通常不会自动阻止越权。

还要区分应用用户与数据库连接账号。网站有几千名读者，不代表每人一定都有独立 DBMS 登录账号；应用可能使用一个受限服务账号连接数据库，再执行用户级业务授权。若采用这种结构，应用不能仅凭浏览器提交的 reader_id 决定可访问对象，必须把请求与已认证身份关联起来。

## 最小权限：从实际任务倒推授权

最小权限不是“权限越少越好，直到什么也不能做”，而是只授予完成规定任务所需的对象和操作。

例如可以分为：报表角色读取必要汇总；借还服务角色读取读者与副本、写入借阅；维护角色执行经授权的结构迁移；备份角色获取备份必需权限。不要为了省事让所有程序共用超级用户账号。

权限可以按“主体、对象、操作”列矩阵：

| 角色 | 读者公开信息 | 读者电话 | 借阅表 | 修改表结构 |
| --- | --- | --- | --- | --- |
| 报表角色 | 读取 | 无需直接读取 | 必要汇总 | 不需要 |
| 借还服务 | 读取 | 依实际业务限定 | 必要读写 | 不需要 |
| 迁移维护 | 按维护任务 | 按维护任务 | 按维护任务 | 经授权需要 |

职责清楚后，人员变动时更容易维护。RBAC 是基于角色的访问控制：把权限授予角色，再把角色授予相关主体。[PostgreSQL 角色文档](https://www.postgresql.org/docs/18/user-manag.html)说明了角色既可表示登录主体，也可用于归组。

## GRANT、REVOKE 与有效权限

简化的授权示例为：

```sql
CREATE ROLE loan_report NOLOGIN;
GRANT SELECT ON LoanSummary TO loan_report;
GRANT loan_report TO report_login;
```

这里假定 LoanSummary 和 report_login 已存在，且执行者拥有所需管理权限。loan_report 表示权限集合，report_login 是使用该集合的登录角色。实际运行还可能需要数据库连接、模式使用等相应权限。

`GRANT SELECT` 授予读取；INSERT、UPDATE、DELETE 对应不同修改能力；`REVOKE` 撤回已有授予。不要为了查询一张汇总表就使用 GRANT ALL。[官方权限文档](https://www.postgresql.org/docs/18/ddl-priv.html)列出了不同对象适用的权限。

撤回一条直接授权不一定消除最终访问能力：用户还可能通过另一个角色、PUBLIC 或所有者身份获得权限。权限题要画清授予路径，判断**有效权限来自哪些途径**。题目涉及授权转授、级联回收时，还要按给定 DBMS 的规则判断，不能把“撤销”想成对所有来源的绝对拒绝。

## 视图：让使用者只看到合适的表达

假设 Reader 有 `reader_id,name,phone` 三列，普通报表只需要编号与姓名：

```sql
CREATE VIEW ReaderPublic AS
SELECT reader_id, name
FROM Reader;

GRANT SELECT ON ReaderPublic TO loan_report;
```

普通视图保存查询定义，一般不是复制出来的一份独立数据；查询视图时再按规则获得结果。物化视图是另一种情况，不能混淆。[CREATE VIEW 文档](https://www.postgresql.org/docs/18/sql-createview.html)说明了普通视图的性质。

视图可减少暴露的列，也可以用条件限制行。但如果同一账号仍能直接 SELECT Reader 全表，就能绕过这个限制。因此要同时设计基表权限与视图权限，并了解具体 DBMS 对视图所有者、调用者和底层对象的权限检查方式。

把电话显示为 `138****0000` 是一种脱敏表达；它降低直接暴露，但不等于原始数据已经被加密，也不表示所有推断风险都消失。对精确值、可关联标识和明细导出还要按实际需求控制。

## 行级控制与列级控制分别限制什么

列级控制回答“哪些字段可读写”，例如允许读 name、不允许读 phone。行级控制回答“哪些记录可读写”，例如分馆 A 的工作人员只能访问所属分馆读者。

应用自己在每条查询中补 WHERE 是一种做法，但容易漏掉某个导出、更新或后台接口。DBMS 的行安全策略可把符合条件的行限制落实到数据库层，同时仍需普通对象权限。

策略必须基于可信身份信息。如果应用接受请求传来的 branch_id 并直接把它当授权范围，用户可能把 A 改成 B。共用数据库账号时，也要思考如何可靠地传递应用用户上下文，以及连接池复用后会不会残留上一个用户状态。

在 PostgreSQL 中，启用行安全后，没有适用策略时普通访问采用默认拒绝；但超级用户、BYPASSRLS 角色和通常情况下的表所有者会绕过策略。因此测试权限时不能只用管理员账号测试。[官方行安全文档](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)明确列出了这些边界。

## 加密要按数据所处的位置区分

| 位置 | 常见措施 | 主要保护范围 |
| --- | --- | --- |
| 传输中 | TLS，并正确验证服务端身份 | 降低网络窃听和冒充风险 |
| 存储介质中 | 文件系统、磁盘或数据库存储加密 | 介质被取走时的数据暴露 |
| 特定字段 | 合适的字段或应用层加密 | 按设计减少敏感明文暴露范围 |
| 备份和导出中 | 备份加密、访问控制、密钥保护 | 防止副本成为更容易读取的入口 |

加密在某个位置有效，不代表在所有位置都有效。例如磁盘已挂载、数据库正在运行时，合法账号仍可能读到明文；TLS 保护网络传输，不能限制登录后的账号权限。字段若在服务端解密，明文与密钥仍可能在服务端短暂出现。[官方加密选项](https://www.postgresql.org/docs/18/encryption-options.html)给出了不同层次的区分。

密钥管理是加密的一部分：密文与解密密钥若毫无限制地放在一起，保护效果会大幅减弱；若密钥丢失，备份文件完好也可能无法恢复。轮换密钥时还要保留合法历史数据所需的解密能力。

登录口令的校验通常使用专门的带盐口令哈希机制，而不是保存可直接读出的明文，也不是把“可解密”当作登录校验的必要条件。哈希、加密、编码是不同概念；Base64 编码不能提供机密性。

## SQL 注入：输入值为什么不能变成语法

危险的方式是把输入直接拼进查询结构。以下只是说明错误机制：

```python
sql = "SELECT reader_id FROM Reader WHERE name = '" + name + "'"
```

程序本来只想让 name 表示一个姓名。如果输入包含引号和 SQL 条件，拼接后它就可能关闭字符串，改变 WHERE 的逻辑。根源是把“不可信的数据”当成了“SQL 代码的一部分”。

应使用数据库驱动的参数绑定。以使用 `%s` 占位符的 Python 驱动接口为例：

```python
cursor.execute(
    "SELECT reader_id FROM Reader WHERE name = %s",
    (name,)
)
```

这里 `%s` 是驱动参数标记，**不是让程序自己用字符串格式化运算把 name 填进去**；占位符外也不手工加单引号。驱动将值与语句结构分开处理，让输入作为数据参与比较。[OWASP 注入防护文档](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)将参数化列为核心措施。

参数通常用于值，不能随意拿来替代任意表名、列名或 ASC/DESC。确需动态排序字段时，应把前端选项映射到程序预设的允许字段。存储过程、ORM 并不自动安全：内部继续拼接不可信 SQL，仍可能产生注入。

最小权限能限制漏洞影响，却不修复语法拼接问题；仅做输入长度校验、删除几个关键词、手工替换引号，也不能一般性代替正确参数绑定。参数化同样不替代业务授权：安全查询到 R02，不表示当前登录用户有权看 R02。

## 审计：记录到足以追踪，也要保护日志

审计可记录访问主体、时间、对象、动作、成功或失败、请求关联编号等。适合重点关注的事件包括权限修改、异常登录、敏感数据批量读取与导出、关键记录修改。

日志不应变成新的泄露源：不要直接写入口令、密钥、完整令牌；对敏感参数按需求脱敏。日志还应限制访问、保护完整性，并保证时间和请求关联足以支持调查。[OWASP 日志说明](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)可用于继续设计记录内容。

审计日志与恢复用 WAL 的目标不同。WAL 主要帮助重建数据变化，不一定适合直接回答“哪个业务用户为何导出了资料”；审计记录主要帮助责任追踪，也未必能完整重放数据库。不能因为系统“有日志”就认定两项能力都具备。

数据库安全还包括限制网络可达范围、及时维护系统、保护备份和服务凭据等。[OWASP 数据库安全文档](https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html)可作为这些基础措施的查阅入口。

## 把措施组合到一个具体场景

现在给分馆报表服务开放“本馆每月借阅统计”，可以这样推导：

1. 明确只需要汇总数量，不需要电话和逐人历史，因此先设计最少字段的查询或视图。
2. 为报表服务分配独立的只读角色，不授予借阅修改和结构管理权限。
3. 根据可信身份限制分馆范围，核查直接访问基表是否可能绕开限制。
4. 查询参数通过驱动绑定，连接使用合适传输保护，凭据有受控存放方式。
5. 记录必要的导出和权限事件，备份也纳入保护范围。

每一步针对一种具体失败。安全设计的价值是减少可触达的数据与操作，并保留可核查的边界，而不是把术语堆在一起。

## 补充：列级撤权，先对准对象，再检查其他授权路径

假设授权关系只有下面一条，ZHAO 没有其他角色、表级更新权限或所有者权限：

```sql
GRANT UPDATE (phone) ON Reader TO ZHAO;
REVOKE UPDATE (phone) ON Reader FROM ZHAO;
```

第一句只给更新 phone 列的能力；第二句撤回这项列级授权。它不表示删除 phone 列，不是撤回 SELECT，也不影响另一位用户已有的权限。括号中的 phone 限定列，ON 后限定表，FROM 后限定被撤权主体。[PostgreSQL REVOKE 文档](https://www.postgresql.org/docs/18/sql-revoke.html)列出了列级撤权的语法。

再改变一个条件：如果 ZHAO 同时通过角色 contact_editor 获得整表 UPDATE，那么仅撤销直接的 UPDATE(phone)，不一定使他失去更新 phone 的有效能力。做题时可把权限来源画成路径：直接授权、角色继承、公共角色、所有者或管理身份。撤掉一条路径，不等于其他路径自动消失。

产品语法也要区分。上面的写法是 PostgreSQL 的例子，不能据此推断每个 DBMS 的全部授权规则都相同。题干给了具体产品与版本时，应使用该产品的权限模型。

## 补充：SQL Server 的登录身份与数据库用户不在同一层

在常见 SQL Server 身份映射场景中，**登录名 login**用于实例层的身份访问，**数据库用户 user**是某个数据库内的身份，数据库角色与对象权限又在相应作用域中组织。一个普通登录名可在数据库 A 映射成用户 report_a，在数据库 B 映射成用户 report_b；二者的名字不必相同。

例如 report_a 在 A 库加入只读报表角色，并不会因此自动在 B 库获得修改工单的权限。应分别检查能否访问实例、能否进入对应数据库、在该数据库中能操作什么对象。只知道“登录成功”不足以回答能否 UPDATE 某张表。

这也不能反推“除了 guest，任何数据库用户都必定对应一个服务器登录名”。SQL Server 还有包含数据库用户、WITHOUT LOGIN 等情形；这些身份的用途与认证路径需要单独判断。[Microsoft 创建数据库用户文档](https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/create-a-database-user?view=sql-server-ver15)明确区分了多种用户类别。学习这种产品知识时，保留题目的前提比背一个绝对断言更可靠。

## 补充：普通视图不等于缓存，也不保证查询加速

假设 ReaderPublic 只是查询 Reader 的普通视图。基表新增一条符合条件的已提交记录，后续查询在相应事务可见性规则下可以从视图得到它；无需先执行一次“刷新普通视图”。原因是普通视图主要保存查询定义，并非自动持有一份独立结果缓存。

把 `SELECT ... FROM Reader` 换成 `SELECT ... FROM ReaderPublic`，可能帮助复用表达、限制暴露范围，却不能单凭名称保证减少读页或连接。实际速度仍取决于底层查询、索引、数据分布和执行计划。某个复杂视图也可能产生昂贵查询。

物化视图则会保存结果，通常还需要设计刷新与数据新鲜度。用缓存加速时要回答“何时更新、允许多旧”，用普通视图限制访问时要回答“谁有底层权限、检查使用谁的身份”。性能与授权是两个需要分别验证的目标。

## 辨析题方法与自查

做题先找主体、对象与动作：谁想读哪列、改哪行？再看题目需要预防、发现还是恢复。问“防止把输入变成 SQL 条件”应想到参数化；问“只让报表看必要列”应想到授权和视图；问“介质丢失”要看存储与备份加密；问“事后追踪谁做的”要看审计。

自查：

1. 登录成功就能读所有表吗？**不能，还要检查授权。**
2. 存储加密是否允许把所有应用设成管理员？**不允许，两者解决不同问题。**
3. 给了受限视图，是否就能忽略基表权限？**不能，否则可能绕过视图。**
4. 参数化查询能防止用户读取不属于自己的合法记录吗？**不能单独做到，还要执行对象级业务授权。**
