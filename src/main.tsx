import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { FirebaseProvider } from './contexts/FirebaseContext';
import { installGlobalUppercaseEnforcement } from './utils/enforceUppercase';

installGlobalUppercaseEnforcement();

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : 'Unexpected display error.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#EEF3F8] flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-white border border-[#C2D0DF] rounded-2xl shadow-xl p-6 text-center space-y-4">
            <h1 className="text-lg font-black text-[#1C2833]">GatePass Portal Recovery</h1>
            <p className="text-xs text-[#5B738B] leading-relaxed">
              An unexpected rendering issue occurred after loading data. Click Reload to recover without losing any records.
            </p>
            {this.state.errorMessage && (
              <p className="text-[11px] font-mono bg-[#FFF5F5] border border-[#F5B8B8] text-[#B91C1C] rounded-lg px-3 py-2 break-words">
                {this.state.errorMessage}
              </p>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 bg-[#0A6ED1] hover:bg-[#085CAF] text-white font-bold text-xs rounded-xl shadow cursor-pointer"
            >
              Reload GatePass Portal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <FirebaseProvider>
      <App />
    </FirebaseProvider>
  </AppErrorBoundary>
);
