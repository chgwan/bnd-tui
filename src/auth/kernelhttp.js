// 经内核发 HTTP(逐字对应官方 main.js 的 fetchApi):
// URL 追加 COMMON_PARAM,cookie JSON 走第 3 参(不是请求体),响应经回调异步返回。
import koffi from 'koffi';
import { PROTOS } from '../kernel/glue.gen.js';

const APP_PARAM_ID_COMMON_PARAM = 3;
const CB_REFS = new Set(); // 回调指针须持有到进程退出(与事件总线同一约束)

export function encodeForm(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function commonParam(api) {
  const out = [0];
  const value = api.browser_engine_get_param_by_id(APP_PARAM_ID_COMMON_PARAM, out);
  return out[0] > 0 ? value : '';
}

export function kernelPost(api, url, params, cookieJson, { timeoutMs = 20000 } = {}) {
  const fullUrl = `${url}${url.includes('?') ? '&' : '?'}${commonParam(api)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`内核请求超时:${url}`)), timeoutMs);
    const cbPtr = koffi.register((_taskId, httpTask, errNo, _headers, data) => {
      clearTimeout(timer);
      // 推迟到内核回调返回之后:否则 await 的续体在回调栈内运行,
      // 紧接着调用 set_login_state 属于重入内核,会段错误
      setImmediate(() => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`内核请求无有效响应:${url}(errNo=${errNo},httpTask=${httpTask})`));
        }
      });
    }, koffi.pointer(PROTOS.HttpRequestComplete));
    CB_REFS.add(cbPtr);

    const rc = api.browser_engine_http_upload_memory(fullUrl, encodeForm(params), cookieJson, [-1], cbPtr);
    if (rc !== 0) {
      clearTimeout(timer);
      reject(new Error(`内核请求发起失败:${url}(rc=${rc})`));
    }
  });
}
