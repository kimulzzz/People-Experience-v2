import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-800">
          <div className="max-w-md w-full bg-white rounded-2xl p-6 shadow-xl border border-red-100 space-y-4 text-center">
            <div className="w-12 h-12 bg-red-100 text-[#ED1C24] rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-extrabold text-[#231F20]">
              Application Interface Error
            </h2>
            <p className="text-xs text-gray-500">
              The system encountered an error while rendering this component. Please reload the page.
            </p>
            {this.state.error && (
              <div className="p-3 bg-red-50 text-left rounded-lg text-xs font-mono text-red-700 max-h-36 overflow-auto border border-red-200">
                {this.state.error.toString()}
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2.5 bg-[#ED1C24] hover:bg-[#D91B23] text-white rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
