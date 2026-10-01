import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Routes,
  Route,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  ArrowRight,
  BusFront,
  Menu,
  X,
  Sparkles,
  Ticket,
  LogOut,
  ShieldCheck,
  ChevronDown,
  Moon,
  Sun,
} from "lucide-react";
import { api, type User } from "./lib";
import Home from "./Home";
import {
  SearchPage,
  SeatPage,
  CheckoutPage,
  BookingsPage,
  TicketPage,
} from "./Booking";
import Admin from "./Admin";
import Jarvis from "./Jarvis";
import TrackingPage from "./Tracking";
type Context = {
  user: User | null;
  login: (user: User, token: string) => void;
  notify: (message: string) => void;
  openJarvis: (prompt?: string) => void;
};
const C = createContext<Context>(null!);
export const useApp = () => useContext(C);
type Theme = "light" | "dark";

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [toast, setToast] = useState(""),
    [jarvis, setJarvis] = useState(false),
    [prompt, setPrompt] = useState(""),
    [menu, setMenu] = useState(false),
    [theme, setTheme] = useState<Theme>(() => {
      const saved = localStorage.getItem("hb-theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    });
  const nav = useNavigate(),
    location = useLocation();
  useEffect(() => {
    if (sessionStorage.getItem("hb-token"))
      api("/auth/me")
        .then(setUser)
        .catch(() => sessionStorage.removeItem("hb-token"));
  }, []);
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("hb-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 6000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  function login(u: User, t: string) {
    sessionStorage.setItem("hb-token", t);
    setUser(u);
  }
  return (
    <C.Provider
      value={{
        user,
        login,
        notify: setToast,
        openJarvis: (p = "") => {
          setPrompt(p);
          setJarvis(true);
        },
      }}
    >
      <header className="header">
        <Link to="/" className="brand" aria-label="HEAVEN-BUS home">
          <span className="brand-icon">
            <BusFront size={24} />
          </span>
          <span>
            HEAVEN<span className="brand-light">—BUS</span>
            <small>THE JOURNEY FEELS DIFFERENT.</small>
          </span>
        </Link>
        <nav className={menu ? "nav open" : "nav"}>
          <Link
            className={
              ["/search", "/trip/", "/checkout/"].some((path) =>
                location.pathname.startsWith(path),
              )
                ? "active"
                : ""
            }
            to="/search"
          >
            Find a bus
          </Link>
          <Link
            className={
              ["/bookings", "/ticket/"].some((path) =>
                location.pathname.startsWith(path),
              )
                ? "active"
                : ""
            }
            to="/bookings"
          >
            My journeys
          </Link>
          <button
            className="nav-jarvis"
            onClick={() => {
              setJarvis(true);
              setMenu(false);
            }}
          >
            <Sparkles size={16} /> Ask Jarvis{" "}
            <span className="tiny-pill">NEW</span>
          </button>
          {user?.role === "admin" && (
            <Link
              className={location.pathname === "/admin" ? "active" : ""}
              to="/admin"
            >
              Operations
            </Link>
          )}
        </nav>
        <div className="header-actions">
          <button
            className="theme-toggle"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            <span className="theme-toggle-track">
              <span className="theme-toggle-thumb">
                {theme === "light" ? <Sun size={15} /> : <Moon size={15} />}
              </span>
            </span>
            <span className="theme-toggle-label">
              {theme === "light" ? "Light" : "Dark"}
            </span>
          </button>
          {user ? (
            <>
              <span className="user-name">Hi, {user.name.split(" ")[0]}</span>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={() => {
                  sessionStorage.removeItem("hb-token");
                  setUser(null);
                  nav("/");
                }}
              >
                <LogOut size={19} />
              </button>
            </>
          ) : (
            <Link className="button button-dark small" to="/login">
              Sign in <ArrowRight size={16} />
            </Link>
          )}
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle menu"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/trip/:id" element={<SeatPage />} />
          <Route
            path="/checkout/:id"
            element={
              <Protected>
                <CheckoutPage />
              </Protected>
            }
          />
          <Route
            path="/bookings"
            element={
              <Protected>
                <BookingsPage />
              </Protected>
            }
          />
          <Route
            path="/ticket/:id"
            element={
              <Protected>
                <TicketPage />
              </Protected>
            }
          />
          <Route
            path="/journey/:id/live"
            element={
              <Protected>
                <TrackingPage />
              </Protected>
            }
          />
          <Route
            path="/admin"
            element={
              <Protected>
                <Admin />
              </Protected>
            }
          />
          <Route path="/login" element={<AuthPage />} />
          <Route
            path="*"
            element={
              <div className="empty-state">
                <BusFront />
                <h1>A little off-route.</h1>
                <p>Let’s get you back to your next journey.</p>
                <Link to="/" className="button button-dark">
                  Back home
                </Link>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="footer">
        <Link to="/" className="brand">
          <BusFront />
          <strong>HEAVEN—BUS</strong>
        </Link>
        <p>Good journeys begin with a little peace of mind.</p>
        <div>
          <span>Built for the journey.</span>
          <span>Demo booking platform · No real tickets issued</span>
        </div>
      </footer>
      {!jarvis && (
        <button className="jarvis-fab" onClick={() => setJarvis(true)}>
          <Sparkles size={20} />
          <span>Ask Jarvis</span>
          <span className="online-dot" />
        </button>
      )}
      {jarvis && (
        <Jarvis
          initialPrompt={prompt}
          onClose={() => {
            setJarvis(false);
            setPrompt("");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button onClick={() => setToast("")} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
    </C.Provider>
  );
}
function Protected({ children }: { children: ReactNode }) {
  const { user } = useApp(),
    location = useLocation();
  if (!user)
    return (
      <div className="empty-state">
        <Ticket size={40} />
        <h1>Your journeys, all in one place.</h1>
        <p>Sign in to reserve seats and manage your bookings.</p>
        <Link
          className="button button-dark"
          to={`/login?next=${encodeURIComponent(location.pathname)}`}
        >
          Sign in to continue <ArrowRight size={18} />
        </Link>
      </div>
    );
  return <>{children}</>;
}
function AuthPage() {
  const { login, user } = useApp(),
    nav = useNavigate();
  const [register, setRegister] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const next =
    new URLSearchParams(useLocation().search).get("next") ?? "/bookings";
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/bookings";
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <span className="eyebrow light">WELCOME ABOARD</span>
        <h1>
          Your next chapter
          <br />
          starts with
          <br />
          <em>a window seat.</em>
        </h1>
        <p>
          Save your place. Find your people.
          <br />
          Make the journey part of the story.
        </p>
        <div className="auth-line">
          <ShieldCheck />
          Your seats. Your five minutes. Peace of mind.
        </div>
      </section>
      <section className="auth-form">
        <span className="eyebrow">A LITTLE CLOSER TO YOUR NEXT JOURNEY</span>
        <h1>{register ? "Make yourself at home." : "Good to see you."}</h1>
        <p>
          {register
            ? "Create your HEAVEN-BUS account."
            : "Sign in and pick up where you left off."}
        </p>
        {user ? (
          <>
            <p>You’re signed in as {user.name}.</p>
            <Link to={safeNext} className="button button-dark">
              Continue <ArrowRight size={18} />
            </Link>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const data = new FormData(e.currentTarget);
              try {
                const r = await api(
                  `/auth/${register ? "register" : "login"}`,
                  {
                    method: "POST",
                    body: JSON.stringify(Object.fromEntries(data)),
                  },
                );
                login(r.user, r.token);
                nav(safeNext);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {register && (
              <label>
                Full name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  placeholder="Your name"
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={10}
                maxLength={100}
                placeholder="At least 10 characters"
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="button button-dark full" disabled={busy}>
              {busy ? "One moment…" : register ? "Create account" : "Sign in"}
              <ArrowRight size={18} />
            </button>
            <p className="auth-switch">
              {register ? "Already travelling with us?" : "New around here?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setRegister(!register);
                  setError("");
                }}
              >
                {register ? "Sign in" : "Create an account"}
              </button>
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
