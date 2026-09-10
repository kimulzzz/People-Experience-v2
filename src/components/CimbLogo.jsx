import React, { useState } from 'react';

/**
 * Official CIMB Niaga Corporate Logo Component.
 * Uses the official PNG logo requested:
 * https://1.bp.blogspot.com/-xWjQErvF_k4/YTBiJ78HTGI/AAAAAAAAARY/RsPergEAVGsC9VqIVBD2GYkdeGkgic2ZgCLcBGAsYHQ/s0/CIMB%2BNiaga%2BLogo%2B-%2BDownload%2BFree%2BPNG.png
 */
export default function CimbLogo({ className = "h-9", showText = true, variant = "default" }) {
  const [imgSrc, setImgSrc] = useState('/cimb-niaga-logo.png');
  const [imgError, setImgError] = useState(false);

  const handleImgError = () => {
    setImgError(true);
  };

  return (
    <div className={`flex items-center space-x-2.5 ${className}`}>
      {!imgError ? (
        <img
          src={imgSrc}
          alt="CIMB Niaga Official Logo"
          className="h-9 sm:h-10 w-auto object-contain max-w-[180px] sm:max-w-[220px] drop-shadow-2xs"
          onError={handleImgError}
        />
      ) : (
        /* Official SVG Vector Representation of CIMB Logo */
        <div className="flex items-center space-x-2">
          {/* CIMB Red Octagonal / Polygonal Shield Mark */}
          <svg className="h-8 w-8 shrink-0" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="14" fill="#ED1C24" />
            {/* Upper Polygon */}
            <path d="M22 22 H78 L48 54 H22 Z" fill="#FFFFFF" />
            {/* Lower Polygon */}
            <path d="M30 60 H78 V78 H52 Z" fill="#FFFFFF" />
            {/* Forward Chevron Accent */}
            <polygon points="56,22 80,48 56,74 46,64 62,48 46,32" fill="#FFFFFF" opacity="0.95" />
          </svg>
          {showText && (
            <div className="flex flex-col justify-center">
              <span className="font-black text-lg leading-tight tracking-tight text-[#231F20]">
                CIMB <span className="font-extrabold text-sm tracking-normal text-[#ED1C24]">NIAGA</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

