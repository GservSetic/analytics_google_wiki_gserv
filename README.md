# Dashboard Analytics · Wiki SETIC

Dashboard institucional em HTML, CSS e JavaScript com duas funções serverless (`/api/realtime` e `/api/report`) para consultar o Google Analytics 4 com segurança.

## Estrutura

- `index.html` — interface do dashboard
- `styles.css` — identidade visual e responsividade
- `app.js` — atualização automática e gráficos SVG
- `api/realtime.js` — Google Analytics Data API `runRealtimeReport`
- `api/report.js` — Google Analytics Data API `runReport`
- `api/_ga.js` — autenticação server-side com conta de serviço

## Rodar a prévia

Sem variáveis de ambiente, o painel abre em modo demonstração com dados de exemplo reais da Wiki usados apenas para validar o visual.

```bash
npm install
npx vercel dev
```

## Ligar ao GA4

1. No Google Cloud, crie ou escolha um projeto.
2. Ative **Google Analytics Data API**.
3. Crie uma **Service Account**.
4. No GA4, em **Administrador > Gerenciamento de acesso à propriedade**, adicione o e-mail da Service Account como **Visualizador**.
5. Configure as variáveis de ambiente:

```env
GA_PROPERTY_ID=554924878
GA_CLIENT_EMAIL=...
GA_PRIVATE_KEY=...
```

> Nunca coloque `GA_PRIVATE_KEY` no `app.js` ou em qualquer arquivo público.

## Incorporar na Wiki

Depois do deploy, use um iframe na página desejada:

```html
<iframe
  src="https://SEU-DASHBOARD.vercel.app"
  title="Analytics da Wiki SETIC"
  width="100%"
  height="1200"
  style="border:0;border-radius:16px;background:#f5f8fc"
  loading="lazy">
</iframe>
```

## Atualização

- Tempo real: a interface consulta `/api/realtime` a cada 15 segundos.
- Histórico: o período é consultado ao trocar entre Hoje, 7 dias e 30 dias.
- O GA4 Realtime representa atividade dos minutos mais recentes; não é um sistema de identificação individual de visitantes.
