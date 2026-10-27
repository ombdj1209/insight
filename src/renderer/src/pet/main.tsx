import { createRoot } from 'react-dom/client'
import '@fontsource-variable/google-sans-flex/full.css'
import { PetApp } from './PetApp'
import { VisitorApp } from './VisitorApp'

createRoot(document.getElementById('root')!).render(location.hash === '#visitor' ? <VisitorApp /> : <PetApp />)
