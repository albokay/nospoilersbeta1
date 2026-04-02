import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App'

// Single wildcard route: React Router owns the URL, App derives all nav
// state from useLocation() — back/forward work natively.
const router = createBrowserRouter([
  { path: '*', element: <App /> }
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
