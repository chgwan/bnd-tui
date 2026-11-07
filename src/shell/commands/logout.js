// bnd logout:清除内核登录态并删除本地凭证。
import { logout } from '../../auth/state.js';

export async function run(ctx) {
  logout(ctx?.api);
  console.log('已退出登录');
}
