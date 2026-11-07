// SEA 入口不支持 import();bin/bnd.js 有顶层 await 又不能 require,经磁盘上的这个文件中转。
import('../bin/bnd.js').catch((e) => {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
});
