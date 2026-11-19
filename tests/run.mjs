// 同进程执行，兼容限制创建子进程的本机开发环境。
await import('./rules.test.mjs');
await import('./access.test.mjs');
await import('./server.test.mjs');
await import('./ingestion.test.mjs');
await import('./ingestion-demo.test.mjs');
await import('./ontology.test.mjs');
await import('./preview.test.mjs');
