import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppProvider, useApp } from "./state";
import { AuthPage } from "./auth-pages";
import { CommunityPage, InvitePage } from './communities';
import { Layout } from "./layout";
import { ChatPage } from "./chat";
import { FriendsPage, ProfilePage } from "./people";
import { SettingsPage } from "./settings";
import { GroupPage } from "./groups";
import { AdminPage } from "./admin";
import { Brand, Spinner } from "./ui";
import "./styles.css";
function Guard() {
  const { user, loading } = useApp(),
    location = useLocation();
  if (loading)
    return (
      <div className="app-bootstrap">
        <Brand />
        <Spinner label="正在连接你的空间…" />
      </div>
    );
  return user ? (
    <Outlet />
  ) : (
    <Navigate to="/login" state={{ from: location.pathname }} replace />
  );
}
function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/login" element={<AuthPage key="login" mode="login" />} />
          <Route path="/register" element={<AuthPage key="register" mode="register" />} />
          <Route path="/forgot-password" element={<AuthPage key="forgot" mode="forgot" />} />
          <Route path="/reset-password" element={<AuthPage key="reset" mode="reset" />} />
          <Route element={<Guard />}>
            <Route element={<Layout />}>
              <Route path="/servers/:serverId/settings" element={<CommunityPage />} />
              <Route path="/servers/:serverId" element={<CommunityPage />} />
              <Route path="/servers/:serverId/channels/:id" element={<ChatPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/chat/:id" element={<ChatPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/profile/:id" element={<ProfilePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/groups/:id" element={<GroupPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
