import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar }   from './components/layout/Sidebar';
import { Landing }   from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Receipts }  from './pages/Receipts';
import { Vault }     from './pages/Vault';
import { Markets }   from './pages/Markets';
import { Explorer }  from './pages/Explorer';
import { Profile } from './pages/Profile';
import { ToastProvider } from './components/ui/Toast';
import { WalletProvider } from './components/WalletContext';
import './styles/global.css';

export default function App() {
  return (
    <WalletProvider>
    <ToastProvider>
    <BrowserRouter>
      <Routes>
        {/* Landing — full-screen, no sidebar */}
        <Route path="/landing" element={<Landing />} />

        {/* App shell with sidebar */}
        <Route path="/*" element={
          <div className="app-shell">
            <Sidebar />
            <main className="main-content">
              <Routes>
                <Route path="/"         element={<Dashboard />} />
                <Route path="/receipts" element={<Receipts />}  />
                <Route path="/vault"    element={<Vault />}     />
                <Route path="/markets"  element={<Markets />}   />
                <Route path="/explorer" element={<Explorer />}  />
                <Route path="/profile" element={<Profile />}  />
              </Routes>
            </main>
          </div>
        } />
      </Routes>
    </BrowserRouter>
    </ToastProvider>
    </WalletProvider>
  );
}