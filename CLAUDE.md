# CLAUDE.md

Site estático bilingue (pt/en) do bar **Entrelinhas** (entrelinhasbar.com), alojado no **Netlify**. Sem backend nem base de dados: o conteúdo vive em YAML + imagens no Git, e cada push na `main` dispara deploy. O `README.md` tem a documentação completa para quem edita conteúdo; este ficheiro é o resumo para trabalhar no código.

Idioma do projeto: **português (pt-PT)** — código, comentários, mensagens do build e commits.

## Comandos

```bash
npm install
npm run build          # node build.js → gera dist/
npm run dev            # build + npx serve dist (http://localhost:3000/)
npm run placeholders   # imagens de teste (placehold.co; `-- --local` sem rede)
npm run clean-images -- --before HEAD~1 --dry   # ver que imagens de eventos apagados seriam removidas
```

Node 22 (`.nvmrc`, `netlify.toml`). Não há testes nem linter: validar correndo `npm run build` (falha com mensagens claras a indicar ficheiro/chave) e, se preciso, abrindo `dist/`.

## Arquitetura

- **`build.js`** — orquestrador: (0) remove eventos passados do `agenda.yaml` e as imagens que só eles usavam; (1) carrega/valida YAML; (2) prepara eventos e otimiza imagens; (3) copia CSS/JS do tema e gera `assets/` com hash; (4) renderiza cada página × idioma + uma página por evento; (5) gera `_redirects`, `sitemap.xml`, `robots.txt`, `404.html`.
  - `THEME_PAGES` — páginas com template mas sem YAML próprio (agenda, venue, mural, newsletter, contacts, privacidade) e o seu título. `NAV_PAGES` = `index` + estas.
  - `OPTIONAL_PAGES` — `newsletter` só existe se `site.yaml › redes.newsletter` estiver preenchido.
  - `UI` — textos fixos da interface (`{{ui.*}}`) por idioma.
  - YAMLs extra em `content/` viram páginas novas (`/<nome>/`); nomes reservados fazem o build falhar.
- **`lib/`**
  - `content.js` — leitura e validação dos YAML (textos `{pt, en}`, fallback para o idioma por defeito com aviso).
  - `events.js` — ordenação por data/hora, slugs, formatação de datas.
  - `past-events.js` — remoção de eventos passados (fuso Lisboa).
  - `images.js` — conversão para **AVIF** com `sharp` (objeto `CONFIG` no topo: larguras, qualidade, presets `og`/`agendaThumb`/`eventBanner`); cache em `.cache/images`.
  - `template.js` — motor de templates próprio, estilo Handlebars: `{{x}}`, `{{{html}}}`, `{{img …}}`, `{{hero …}}`, `{{para x}}`, `{{linhas x}}`, `{{#each}}`, `{{#if}}…{{else}}`, `{{#lang pt}}…{{/lang}}`, `{{> partial}}`. Chave inexistente → build falha.
  - `maps.js` — converte `contactos.yaml › link_google_maps` num URL de embed para o iframe.
  - `util.js` — `BuildError`, `Report`, escape HTML, parsing de YouTube/vídeos, etc.
- **`content/*.yaml`** — `site` (nome, idiomas, `url_base`, GA, redes, `ui.tipos`), `index` (hero, história, equipa, vídeo), `agenda` (eventos), `mural`, `contactos` (telefone, email, morada, horário, mapa, FAQ).
- **`src/templates/`** — páginas + `partials/` (head, header, footer, carousel, hero-default, newsletter-cta). O menu está escrito em `partials/header.html`.
- **`src/css`, `src/js`, `src/fonts`** — tema **Poize** (export WordPress/Elementor) copiado tal como está. Código próprio: `src/css/site.css`, `mural.css`, `contacts.css`, `newsletter.css` e `src/js/main.js`, `analytics.js`, `cookie-consent.js`, `contacts-faq.js`, `hero-slider.js`, `team-reveal.js`, `agenda-past-events.js`. Não editar `src/js/vendor` nem `src/js/theme`.
- **`src/images/`** — originais; o build converte tudo para AVIF e reescreve as referências. Nunca referenciar `.avif` gerados nos YAML.
- **`.pages.yml`** — formulários do Pages CMS. As chaves têm de coincidir com as dos YAML: ao acrescentar/renomear um campo no YAML, atualizar também aqui.
- **`.github/workflows/limpar-imagens.yml`** — em pushes que alterem `content/**`, corre `scripts/clean-images.js` e faz commit `[skip ci]` a apagar imagens de eventos removidos (aborta se > 20).

## URLs e idiomas

pt (por defeito) na raiz (`/`, `/agenda/`, `/event/<slug>/`); en com prefixo `/en/`. Slug do evento vem do título, ou do campo opcional `slug`. `_redirects`: `/pt/...` → `/...` e `/programming/` → `/agenda/`.

## Segurança / CSP

Cabeçalhos e CSP em `netlify.toml`. **Sem scripts inline** (`script-src 'self'` + googletagmanager) — todo o JS vai em ficheiros. Estilos inline são permitidos (o tema precisa). Novos domínios externos (iframes, imagens, scripts) têm de ser acrescentados à CSP. Links aceites: `https://`, `http://`, `mailto:`, `tel:`.

## Notas

- `dist/` está no `.gitignore` mas há ficheiros de `dist/` versionados de commits antigos; o Netlify gera o seu próprio `dist/`.
- O build no Netlify não altera o repositório; para limpar eventos passados no Git, correr `npm run build` localmente e fazer commit.
- `content/site.yaml`: o `.vscode/settings.json` desativa o SchemaStore para não ser validado como playbook Ansible.
