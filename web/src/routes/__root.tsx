import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Header } from '../components/Header.tsx'
import { HouseholdProvider } from '../context/HouseholdContext.tsx'

export const Route = createRootRoute({
  component: () => (
    <HouseholdProvider>
      <Header />
      <Outlet />
    </HouseholdProvider>
  ),
})
