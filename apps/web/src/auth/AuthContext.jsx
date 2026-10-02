import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((r) => {
        setUser(r.data.user);
        setPermissions(r.data.permissions || []);
        if (r.data.user?.name) localStorage.setItem('userName', r.data.user.name);
      })
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (phone, password) => {
    const r = await api.post('/auth/login', { phone, password });
    localStorage.setItem('token', r.data.accessToken);
    setUser(r.data.user);
    setPermissions(r.data.permissions || []);
    if (r.data.user?.name) localStorage.setItem('userName', r.data.user.name);
    return r.data.user;
  };

  /**
   * PIN 快捷登录(换班/收银台快速切换),不需要密码。
   * - 登录页:传 phone + pin(精确匹配)
   * - 已登录终端换人:只传 pin + storeId(在该店已设 PIN 的员工里比对)
   */
  const loginWithPin = async (pin, opts = {}) => {
    const body = { pin };
    if (opts.phone) body.phone = opts.phone;
    if (opts.storeId) body.storeId = opts.storeId;
    const r = await api.post('/auth/pin-login', body);
    localStorage.setItem('token', r.data.accessToken);
    setUser(r.data.user);
    setPermissions(r.data.permissions || []);
    if (r.data.user?.name) localStorage.setItem('userName', r.data.user.name);
    return r.data.user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userName');
    setUser(null);
    setPermissions([]);
  };

  /** 重新拉取权限(后台改过矩阵、或自己改了角色后调用)。 */
  const refreshPermissions = async () => {
    try {
      const r = await api.get('/auth/permissions');
      setPermissions(r.data.permissions || []);
      return r.data.permissions || [];
    } catch {
      return permissions;
    }
  };

  // '*' 通配:admin 拥有全部按键
  const can = (key) => Array.isArray(permissions) && (permissions.includes('*') || permissions.includes(key));

  const value = useMemo(
    () => ({ user, setUser, permissions, setPermissions, login, loginWithPin, logout, refreshPermissions, can, loading }),
    // can/permissions 每次渲染重建即可,依赖列表保持精简
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, permissions, loading],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/** 需要某个按键权限才渲染的包装组件。 */
export function Gate({ perm, children, fallback = null }) {
  const { can } = useAuth();
  if (Array.isArray(perm)) return perm.some((p) => can(p)) ? children : fallback;
  return can(perm) ? children : fallback;
}
