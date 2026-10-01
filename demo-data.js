window.DEMO_DATA = {
  realtime: {
    mode: 'demo', generatedAt: new Date().toISOString(), windowMinutes: 30,
    summary: { activeUsers: 7, views: 19, events: 46 },
    timeline: [
      { minutesAgo: 5, activeUsers: 2, views: 3 }, { minutesAgo: 4, activeUsers: 3, views: 5 },
      { minutesAgo: 3, activeUsers: 3, views: 4 }, { minutesAgo: 2, activeUsers: 5, views: 7 },
      { minutesAgo: 1, activeUsers: 6, views: 8 }, { minutesAgo: 0, activeUsers: 7, views: 9 }
    ],
    pages: [
      { name: 'Carteira de Identidade Nacional (CIN)', activeUsers: 3, views: 7 },
      { name: 'Dúvidas Frequentes — Portal do Cidadão', activeUsers: 2, views: 5 },
      { name: 'Wiki SETIC — Página inicial', activeUsers: 1, views: 3 },
      { name: 'Autenticação de dois fatores do SEI', activeUsers: 1, views: 2 }
    ],
    devices: [{ name: 'desktop', activeUsers: 5 }, { name: 'mobile', activeUsers: 2 }],
    cities: [{ name: 'Porto Velho', activeUsers: 3 }, { name: 'São Paulo', activeUsers: 2 }, { name: 'Brasília', activeUsers: 1 }, { name: 'Outras', activeUsers: 1 }]
  },
  reports: {
    today: {
      mode: 'demo', range: 'today', generatedAt: new Date().toISOString(),
      summary: { activeUsers: 20, sessions: 21, views: 30, engagementRate: 0.1429, avgEngagementSeconds: 9.381 },
      daily: [{ date: '20261001', activeUsers: 20, sessions: 21, views: 30 }],
      pages: [
        { name: '/home/base_conhecimento/manuais/portal_cidadao/cin', activeUsers: 3, views: 3 },
        { name: '/home/base_conhecimento/manuais/portal_cidadao/duvidas_frequentes', activeUsers: 1, views: 2 },
        { name: '/', activeUsers: 1, views: 1 },
        { name: '/home/base_conhecimento/manuais/novos_servidores', activeUsers: 1, views: 1 }
      ],
      devices: [{ name: 'desktop', activeUsers: 16, sessions: 17 }, { name: 'mobile', activeUsers: 4, sessions: 4 }],
      cities: [{ name: 'São Paulo', activeUsers: 4 }, { name: 'Porto Velho', activeUsers: 2 }, { name: 'Brasília', activeUsers: 2 }, { name: 'Cuiabá', activeUsers: 2 }]
    },
    '7d': {
      mode: 'demo', range: '7d', generatedAt: new Date().toISOString(),
      summary: { activeUsers: 1511, sessions: 1871, views: 3410, engagementRate: 0.571, avgEngagementSeconds: 49.4 },
      daily: [
        { date: '20260925', activeUsers: 1, sessions: 1, views: 2 }, { date: '20260927', activeUsers: 1, sessions: 1, views: 1 },
        { date: '20260928', activeUsers: 549, sessions: 620, views: 1051 }, { date: '20260929', activeUsers: 546, sessions: 660, views: 1243 },
        { date: '20260930', activeUsers: 463, sessions: 573, views: 1086 }, { date: '20261001', activeUsers: 20, sessions: 21, views: 30 }
      ],
      pages: [
        { name: '/home/base_conhecimento/manuais/portal_cidadao/cin', activeUsers: 586, views: 725 },
        { name: '/home/base_conhecimento/manuais/portal_cidadao/duvidas_frequentes', activeUsers: 488, views: 629 },
        { name: '/', activeUsers: 76, views: 200 },
        { name: '/home/base_conhecimento/manuais/sei/peticionamento_cidadao', activeUsers: 89, views: 112 }
      ],
      devices: [{ name: 'desktop', activeUsers: 781, sessions: 1062 }, { name: 'mobile', activeUsers: 725, sessions: 806 }, { name: 'tablet', activeUsers: 5, sessions: 6 }],
      cities: [{ name: 'Porto Velho', activeUsers: 410 }, { name: 'São Paulo', activeUsers: 115 }, { name: 'Brasília', activeUsers: 84 }, { name: 'Cuiabá', activeUsers: 61 }]
    },
    '30d': {
      mode: 'demo', range: '30d', generatedAt: new Date().toISOString(),
      summary: { activeUsers: 1530, sessions: 1901, views: 3470, engagementRate: 0.568, avgEngagementSeconds: 48.9 },
      daily: [
        { date: '20260918', activeUsers: 2, sessions: 2, views: 6 }, { date: '20260919', activeUsers: 2, sessions: 3, views: 7 },
        { date: '20260920', activeUsers: 1, sessions: 1, views: 1 }, { date: '20260921', activeUsers: 3, sessions: 4, views: 19 },
        { date: '20260922', activeUsers: 5, sessions: 6, views: 14 }, { date: '20260925', activeUsers: 1, sessions: 1, views: 2 },
        { date: '20260927', activeUsers: 1, sessions: 1, views: 1 }, { date: '20260928', activeUsers: 549, sessions: 620, views: 1051 },
        { date: '20260929', activeUsers: 546, sessions: 660, views: 1243 }, { date: '20260930', activeUsers: 463, sessions: 573, views: 1086 },
        { date: '20261001', activeUsers: 20, sessions: 21, views: 30 }
      ],
      pages: [
        { name: '/home/base_conhecimento/manuais/portal_cidadao/cin', activeUsers: 589, views: 728 },
        { name: '/home/base_conhecimento/manuais/portal_cidadao/duvidas_frequentes', activeUsers: 489, views: 631 },
        { name: '/', activeUsers: 77, views: 201 },
        { name: '/home/base_conhecimento/manuais/sei/peticionamento_cidadao', activeUsers: 89, views: 112 }
      ],
      devices: [{ name: 'desktop', activeUsers: 794, sessions: 1083 }, { name: 'mobile', activeUsers: 731, sessions: 812 }, { name: 'tablet', activeUsers: 5, sessions: 6 }],
      cities: [{ name: 'Porto Velho', activeUsers: 418 }, { name: 'São Paulo', activeUsers: 121 }, { name: 'Brasília', activeUsers: 89 }, { name: 'Cuiabá', activeUsers: 65 }]
    }
  }
};
