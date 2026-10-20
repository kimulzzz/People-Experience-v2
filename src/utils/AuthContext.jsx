import { createContext, useContext } from 'react';

// Who is logged in and what they may do. Provided by AuthGate (App.jsx); the server is the real
// enforcer of every rule below - the UI only hides what a user could not use anyway.
//   user         { user_id, username, full_name, role, directorate, division, menu_access, ... }
//   isAdmin      role === 'ADMIN'
//   canManageEvents  Admin or a USER whose menu access includes Signature Program Events (v2.49.0)
//   menuAccess   { dashboard, explore, exit_interview, action_library, events, about: true/false } (Admin: all true)
//   logout()     ends the session
export const AuthContext = createContext({ user: null, isAdmin: false, canManageEvents: false, menuAccess: null, logout: () => {} });

export const useAuth = () => useContext(AuthContext);
