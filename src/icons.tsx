import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...props,
});

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconArrowLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />
  </svg>
);

export const IconFlag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 21V4M6 5h11l-2.5 3.5L17 12H6" />
  </svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
  </svg>
);

export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14" />
  </svg>
);

export const IconFolderOpen = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 7.5h6l2 2H20l-1.6 9H4.4l-.9-11Z" />
    <path d="M3.5 7.5V5.8h6.2l2 2H19" />
  </svg>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="5.5" />
    <path d="M15 15l5 5" />
  </svg>
);

export const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 3v4M15 3v4M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0V7ZM12 16v5" />
  </svg>
);

export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
    <path d="M15.5 8.5V5.5A1 1 0 0 0 14.5 4.5h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
  </svg>
);

export const IconTransfer = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 18.5V5M4.5 8.5L8 5l3.5 3.5M16 5.5V19M12.5 15.5L16 19l3.5-3.5" />
  </svg>
);

export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.1" fill="currentColor" />
  </svg>
);

export const IconUserPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 19.5c.6-3.4 3.2-5.5 6.5-5.5 1.5 0 2.8.4 3.9 1.2M18 14v6M15 17h6" />
  </svg>
);

export const IconBolt = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
  </svg>
);
