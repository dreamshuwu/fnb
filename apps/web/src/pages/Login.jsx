import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Login() {
  const { login, loginWithPin } = useAuth();
  const [mode, setMode] = useState('password');           // 'password' | 'pin'
  const [phone, setPhone] = useState('1000000002');
  const [password, setPassword] = useState('cashier123');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  const land = (u) => navigate(u.role === 'kitchen' ? '/kds' : '/');

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { land(await login(phone, password)); }
    catch { setErr('Login failed / invalid UserID or Password'); }
  };

  const submitPin = async (e) => {
    e.preventDefault(); setErr('');
    if (pin.length < 4) { setErr('PIN 至少 4 位'); return; }
    try { land(await loginWithPin(pin, { phone: phone.trim() })); }
    catch (ex) {
      const st = ex.response?.status;
      setErr(st === 429 ? (ex.response?.data?.error || '尝试次数过多,请稍后再试')
        : st === 400 ? 'PIN 必须是 4-6 位数字'
          : 'PIN 不正确');
      setPin('');
    }
  };

  const press = (k) => {
    setErr('');
    if (k === 'Back') return setPin((p) => p.slice(0, -1));
    if (k === 'Clear') return setPin('');
    if (pin.length >= 6) return;
    setPin((p) => p + k);
  };

  const pad = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['Clear', '0', 'Back']];

  return (
    <div className="legacy-login">
      <div className="legacy-login-title">Food and Beverage Management</div>
      <div className="legacy-login-logo">SMPOS<small>COMPUTERISED POINT OF SALE</small></div>

      <div className="legacy-login-window">
        <header>▣ User Login</header>
        <div className="login-mode-switch">
          <button className={mode === 'password' ? 'active' : ''} onClick={() => { setMode('password'); setErr(''); }}>Password</button>
          <button className={mode === 'pin' ? 'active' : ''} onClick={() => { setMode('pin'); setErr(''); }}>PIN 快捷登录</button>
        </div>

        {mode === 'password' ? (
          <form onSubmit={submit} className="legacy-login-body">
            <label>UserID<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {err && <div className="text-red-700 text-xs">{err}</div>}
            <div className="legacy-window-actions">
              <button className="legacy-btn green">Login</button>
              <button type="button" className="legacy-btn pink" onClick={() => setPassword('')}>Clear</button>
            </div>
            <div className="text-[10px] text-center text-indigo-900">Demo UserID: 1000000002 / cashier123</div>
          </form>
        ) : (
          <form onSubmit={submitPin} className="legacy-login-body">
            <label>UserID<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="登录手机号" /></label>
            <label>PIN
              <div className="pin-display">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={i < pin.length ? 'dot on' : 'dot'} />
                ))}
                <small>{pin.length}/6</small>
              </div>
            </label>
            <div className="pin-pad">
              {pad.flat().map((k) => (
                <button
                  key={k} type="button"
                  className={`pin-key ${k === 'Clear' ? 'warn' : ''} ${k === 'Back' ? 'warn' : ''}`}
                  onClick={() => press(k)}
                >{k === 'Back' ? '⌫' : k}</button>
              ))}
            </div>
            {err && <div className="text-red-700 text-xs">{err}</div>}
            <div className="legacy-window-actions">
              <button className="legacy-btn green">PIN Login</button>
              <button type="button" className="legacy-btn pink" onClick={() => { setPin(''); setErr(''); }}>Clear</button>
            </div>
            <div className="text-[10px] text-center text-indigo-900">PIN 需先在「桌面 → Password」里设置(4-6 位)</div>
          </form>
        )}
      </div>
    </div>
  );
}
