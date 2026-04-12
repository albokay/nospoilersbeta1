import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App'
import BetaGate from './components/BetaGate'

// Single wildcard route: React Router owns the URL, App derives all nav
// state from useLocation() — back/forward work natively.
const router = createBrowserRouter([
  { path: '*', element: <App /> }
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BetaGate>
      <RouterProvider router={router} />
    </BetaGate>
  </React.StrictMode>
)
