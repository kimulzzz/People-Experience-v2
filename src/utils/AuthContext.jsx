import { createContext, useContext } from 'react';

// Who is logged in and what they may do. Provided by AuthGate (App.jsx); the server is the real
// enforcer of every rule below - the UI only hides what a user could not use anyway.
//   user         { user_id, username, full_name, role, directorate, division, ... }
//   isAdmin      role === 'ADMIN'
//   canManageEvents  Admin or a USER of a directorate listed in the `event_manager_directorates` setting
//   logout()     ends the session
export const AuthContext = createContext({ user: null, isAdmin: false, canManageEvents: false, logout: () => {} });

export const useAuth = () => useContext(AuthContext);
