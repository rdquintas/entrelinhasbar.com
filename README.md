# entrelinhasbar.com (estático, pt/en)

Site estático alojado no **Netlify**. O conteúdo editável vive em ficheiros **YAML** e em imagens no repositório Git; cada `commit` na branch principal dispara um deploy automático. Sem backend, sem base de dados, sem segredos.

- **Build:** Node.js (`build.js`) gera o HTML final em `dist/`. O site publicado não lê YAML no browser.
- **Visual:** os templates são o tema **Poize** (export de WordPress/Elementor) convertido em HTML estático. O CSS, o JS e as fontes do tema estão em `src/css`, `src/js` e `src/fonts` e são copiados tal como estão.
- **Imagens:** as originais ficam em `src/images/` e são **todas** convertidas para **AVIF** (sem fallback WebP).
- **Edição:** diretamente nos YAML ou através do **[Pages CMS](https://pagescms.org)** (formulários já configurados em `.pages.yml`).

## Estrutura

```
content/          YAML editáveis (site, index, agenda, mural, contactos)
src/images/       imagens originais (dos YAML e das usadas diretamente pelos templates/CSS)
src/templates/    páginas (index, agenda, event, mural, venue, contacts, 404)
                  + partials/ (head, header, footer, carousel, hero-default)
src/css, src/js, src/fonts   ficheiros do tema, copiados para /css, /js e /fonts
src/css/site.css, mural.css  estilos próprios do site (por cima do tema)
src/js/main.js    JS próprio (carrossel, mural…); src/js/vendor e src/js/theme são do tema
src/static/       copiado para a raiz do site (favicon)
lib/              módulos do build (conteúdo, eventos, eventos passados, imagens, templates)
scripts/          clean-images.js (limpeza) e fetch-placeholders.js (imagens de teste)
.pages.yml        configuração do Pages CMS
.github/workflows/limpar-imagens.yml   remove imagens de eventos apagados
```

## Páginas

| Página | Endereço | De onde vem o conteúdo |
|---|---|---|
| Início | `/` | `index.yaml` (hero + "A nossa história") e eventos com `destaque: true` (carrossel) |
| Agenda | `/agenda/` | eventos de `agenda.yaml` |
| Evento | `/event/<slug>/` | um por evento de `agenda.yaml`; a morada e o link do mapa vêm de `contactos.yaml` |
| Mural | `/mural/` | `mural.yaml` |
| Venue | `/venue/` | HTML fixo em `src/templates/venue.html` (ainda com conteúdo de demonstração do tema) |
| Contactos | `/contacts/` | HTML fixo em `src/templates/contacts.html` |
| 404 | `/404.html` | só no idioma por defeito |

A versão inglesa de cada página tem o prefixo `/en/`. O menu do cabeçalho está escrito diretamente em `src/templates/partials/header.html`, e os títulos das páginas do tema (Calendário, Venue, Mural, Contact Us) estão em `THEME_PAGES`, no `build.js`.

## Como editar o conteúdo

### Textos nos dois idiomas
Cada texto tem uma versão por idioma:

```yaml
titulo:
  pt: "Bem-vindo"
  en: "Welcome"
```

Se faltar uma tradução, o site usa o idioma por defeito (pt) e o build mostra um aviso. Texto com várias linhas: uma linha em branco cria um novo parágrafo. Não se usa HTML.

Os textos fixos dos templates (títulos de secções, etc.) estão no próprio HTML, dentro de blocos `{{#lang pt}}…{{/lang}}` / `{{#lang en}}…{{/lang}}`.

### Ficheiros
| Ficheiro | O que controla |
|---|---|
| `content/site.yaml` | nome, idiomas, `url_base`, `og_imagem`, redes sociais (rodapé), etiquetas dos tipos de evento (`ui.tipos`) |
| `content/index.yaml` | hero por defeito (com título), `historia`, `equipa` (sem limite; cada pessoa com imagem, `nome`, `titulo` e `subtitulo`) e `linkvideo` (vídeo do YouTube, Facebook ou Instagram)* |
| `content/agenda.yaml` | lista de eventos |
| `content/mural.yaml` | hero e itens (imagens ou vídeos YouTube, sem limite) |
| `content/contactos.yaml` | telefone, email, morada, horário, link do Google Maps, FAQ* |

\* A galeria e o vídeo de `index.yaml` e a maior parte de `contactos.yaml` são validados no build mas **não aparecem no site**: os templates atuais não os usam (a página de contactos é HTML fixo). De `contactos.yaml`, só a `morada` e o `link_google_maps` são usados, na página de cada evento.

### Eventos (`content/agenda.yaml`)
- Podem estar por **qualquer ordem**: o site ordena-os por data e hora.
- `data: "2026-11-14"` (AAAA-MM-DD, com aspas) e `hora: "21:30"` (HH:MM, 24 h, com aspas).
- `tipo`: `concerto`, `workshop` ou `outro` (as etiquetas estão em `site.yaml › ui.tipos`).
- `destaque: true` → o evento aparece no **carrossel** da página inicial (no lugar do hero; máx. 10). Sem destaques, mostra o hero por defeito.
- `cancelado: true` → indicação **CANCELADO** no evento, na agenda e no carrossel.
- Eventos com data **anterior a hoje** (Lisboa) são removidos no build: a entrada sai do `agenda.yaml`, as imagens que só eles usavam são apagadas (nunca as que também aparecem noutro YAML, template ou CSS) e a página deixa de existir. Entre builds, a agenda esconde-os no browser.
- **Apagar** o evento do YAML remove-o do site **e** apaga as suas imagens do repositório (ver [Limpeza de imagens](#limpeza-de-imagens-de-eventos-apagados)).
- O endereço do evento é gerado a partir do título: `Tuba ao Vivo` → `/event/tuba-ao-vivo/` (em inglês: `/en/event/tuba-ao-vivo/`). Se mudares o título depois de partilhares o link, o endereço muda; para o fixar, preenche o campo opcional `slug`.
- Cada evento tem uma imagem **horizontal** (obrigatória) e uma **vertical** (opcional, usada em telemóvel no carrossel); até 5 `links`; `youtube` opcional (URL ou ID); `link_bilhetes` opcional (mostra o botão de bilhetes na página do evento).
- Na agenda aparece uma miniatura da imagem horizontal (495×378) e os primeiros ~150 caracteres do `descritivo`; no topo da página do evento, um recorte de 1400×500.

### Mural (`content/mural.yaml`)
- Cada item tem **exatamente um** de `imagem` ou `youtube` (o build falha se tiver os dois ou nenhum).
- A ordem é **baralhada no browser** a cada visita e o mosaico é montado com o [Masonry](https://masonry.desandro.com/) (`masonry-layout`, instalado pelo npm). Sem JavaScript, mostra uma lista simples.

### Imagens
1. Põe o ficheiro original em `src/images/` (jpg, png, webp, tiff, gif, avif ou svg). **Tamanho máximo: 15 MB.** Recomenda-se redimensionar antes (lado maior até ~2400 px).
2. Referencia-o no YAML apenas pelo nome:

```yaml
imagem_horizontal:
  ficheiro: concerto.jpg
  alt: { pt: "Palco ao fim da tarde", en: "Stage at sunset" }
```

O `alt` descreve a imagem para quem não a vê (recomendado). Nos eventos, se faltar, usa-se o título. **Nunca** referencies ficheiros `.avif` gerados: o build decide os nomes finais.

Imagens usadas **diretamente** pelos templates ou pelo CSS (`/images/foto.jpg`) também ficam em `src/images/`: o build converte-as para AVIF no tamanho original e troca as referências em `dist/`. No fim avisa se sobrar alguma referência que não seja AVIF (normalmente, um ficheiro que não existe). SVG e GIF também são convertidos (o SVG é rasterizado; de um GIF animado fica só o 1.º frame).

### Hero
`hero.img_horizontal` (computador/tablet) e `hero.img_vertical` (telemóvel, até 768 px). Se não houver vertical, usa-se a horizontal. É usado na página inicial (quando não há destaques, com `hero.titulo` por cima) e no mural.

## Ajustar a qualidade e as larguras das imagens
No topo de `lib/images.js` há um único objeto `CONFIG`:

| Opção | Valor atual |
|---|---|
| `widths` | `[480, 960, 1600]` (nunca amplia o original) |
| `avifQuality` / `avifEffort` | `50` / `4` |
| `webpFallback` | `false` (põe `true` para gerar também WebP) |
| `webpQuality` | `75` |
| `maxFileBytes` | 15 MB |
| `og` | 1200×630 (imagem de partilha) |
| `agendaThumb` / `eventBanner` | 495×378 / 1400×500 |

O build **falha** (com o nome do ficheiro) se uma imagem estiver corrompida, não existir ou exceder o limite. No fim mostra quantas imagens foram processadas, quantas vieram da cache e a poupança de tamanho.

## Adicionar um idioma
1. Em `content/site.yaml`, acrescenta em `idiomas` (`codigo`, `nome`, `locale`).
2. Acrescenta a nova chave (ex.: `es:`) em **todos** os textos dos YAML (incluindo `ui` e eventos). O que faltar usa o idioma por defeito e o build avisa.
3. Nos templates, acrescenta blocos `{{#lang es}}…{{/lang}}` onde já existem os de `pt`/`en`.
4. Para o Pages CMS, acrescenta também o campo do novo idioma nos blocos `components` de `.pages.yml` (`texto`, `texto_longo`…).

O idioma por defeito (`idioma_padrao`) fica na raiz (`/`, `/agenda/`…); os outros têm prefixo (`/en/`, `/en/agenda/`…). Os URLs, o seletor de idioma e o sitemap são gerados a partir da lista de idiomas.

## Adicionar uma página
1. Cria `content/nova.yaml` (nome em minúsculas, sem acentos) com pelo menos `titulo` e `hero`:
   ```yaml
   titulo: { pt: "Sobre nós", en: "About us" }
   hero:
     img_horizontal: { ficheiro: sobre.jpg, alt: { pt: "…", en: "…" } }
   texto: { pt: "…", en: "…" }
   ```
2. Cria `src/templates/nova.html` (parte de `mural.html`, que já usa `{{> head}}`, `{{> header}}`, `{{> footer}}` e `{{hero}}`; o texto multilinha usa `{{para texto}}`).
3. Acrescenta o link ao menu em `src/templates/partials/header.html`.

A página fica em `/nova/` e `/en/nova/`. Nomes reservados (o build falha): códigos de idioma, `index`, `agenda`, `venue`, `mural`, `contacts`, `event`, `assets`, `images`, `css`, `js`, `fonts`.

### Sintaxe dos templates
`{{campo}}` texto · `{{{html}}}` HTML gerado pelo build · `{{img campo preset=card}}` imagem · `{{hero H V class=… preset=…}}` hero · `{{para campo}}` texto em parágrafos · `{{linhas campo}}` texto com `<br>` · `{{#each lista}}…{{/each}}` · `{{#if x}}…{{else}}…{{/if}}` · `{{#lang pt}}…{{/lang}}` · `{{> partial}}`. Se uma chave não existir no conteúdo, o build falha a indicar qual.

## Fluxo de trabalho
1. Editar YAML/imagens (à mão ou no Pages CMS).
2. `commit` + `push` na branch principal.
3. O Netlify corre `npm run build` e publica `dist/`.
4. **Se o build falhar** (YAML inválido, imagem em falta, data errada…), o Netlify **não publica** e mantém o deploy anterior online. A mensagem de erro indica ficheiro, chave e como corrigir (Netlify → *Deploys* → build falhado → log).

## Testar localmente
```bash
npm install
npm run dev          # build + serve dist em http://localhost:3000/
```
(ou `npm run build` e depois `npx serve dist`; `netlify dev` também serve.) Para (re)gerar as imagens de teste: `npm run placeholders` (descarrega do placehold.co) ou `npm run placeholders -- --local` (gera sem rede).

## Netlify: configuração inicial
1. Cria o repositório (GitHub) e faz push deste projeto.
2. Netlify → *Add new site* → *Import from Git* → escolhe o repositório. O `netlify.toml` já define o comando (`npm run build`), a pasta (`dist`) e o Node 22.
3. Em `content/site.yaml`, define `url_base` com o endereço final (ex.: `https://meusite.netlify.app`) e faz push.
4. **Ativa as notificações de deploy falhado** (Netlify → *Project configuration* → *Notifications* → *Deploy failed*): quem edita pelo CMS não vê o log do Netlify.
5. Redirecionamentos (301, em `dist/_redirects`, gerado pelo build): `/pt/...` → `/...` e a antiga `/programming/` → `/agenda/`.

### Cache de imagens entre builds
O build guarda os resultados em `.cache/images` (ignorado pelo Git; nomes com hash do conteúdo + definições). O `netlify.toml` usa o plugin `netlify-plugin-cache` para o Netlify preservar essa pasta entre builds. **Sem a cache** o build reprocessa todas as imagens: fica mais lento, mas continua correto. Se o plugin der problemas, podes removê-lo do `netlify.toml` sem perder funcionalidade.

## Pages CMS (para quem edita)
1. A pessoa precisa de uma **conta GitHub** com acesso de escrita ao repositório (convidar como *collaborator*).
2. Em [app.pagescms.org](https://app.pagescms.org) → entrar com o GitHub → escolher o repositório. O `.pages.yml` já define um formulário por YAML.
3. Cada **gravação é um commit** na branch principal e dispara um deploy.
4. O CMS reescreve os YAML ao gravar: **comentários e a ordem das chaves podem perder-se**. O site não depende disso.
5. Os campos de imagem escolhem/carregam ficheiros para `src/images/`.

## Limpeza de imagens de eventos apagados
Para o repositório não acumular imagens inúteis, quando um evento é **removido** de `content/agenda.yaml`, as suas imagens são removidas de `src/images/`.

- O build do Netlify nunca altera o repositório, por isso a limpeza corre num **GitHub Action** (`.github/workflows/limpar-imagens.yml`) a cada push que altere `content/**`. Usa só o `GITHUB_TOKEN` automático (sem segredos) e faz um commit com `[skip ci]`, para não repetir o deploy.
- Compara o `agenda.yaml` **anterior** com o **atual**. Só apaga imagens que **eram de eventos** e **já não são referenciadas em nenhum YAML**.
- **Não** apaga: imagens partilhadas com outro conteúdo (outro evento, hero, mural…); uploads recentes ainda por associar a um evento (nunca se faz um varrimento geral de `src/images/`).
- **Atenção:** se trocares a imagem de um evento por outra, a imagem antiga também é apagada (deixa de estar referenciada). O script só olha para os YAML: não reutilizes imagens de eventos diretamente nos templates ou no CSS.
- **Limite de segurança:** se mais de 20 imagens fossem apagadas de uma vez, aborta sem apagar nada e o job falha (visível no separador *Actions*). Para forçar localmente: `npm run clean-images -- --before <commit> --max <N>`.
- Para ver o que seria apagado: `npm run clean-images -- --before HEAD~1 --dry`.
- Se a branch principal não se chamar `main`, altera o workflow. Se a branch tiver proteção que bloqueie pushes do bot, permite-os (ou desativa a proteção para o `github-actions[bot]`).
- **Apagar ficheiros não reduz o histórico do Git:** os ficheiros antigos continuam nos commits anteriores, por isso o `.git` não encolhe. Redimensiona as imagens antes de as carregar.

## Notas
- **Eventos passados** são removidos automaticamente no build (ver [Eventos](#eventos-contentagendayaml)). O build do Netlify não altera o repositório: para o `agenda.yaml` e as imagens ficarem limpos no Git, corre `npm run build` localmente e faz commit.
- Segurança: cabeçalhos e CSP no `netlify.toml`. Vídeos via `youtube-nocookie.com`; as miniaturas do mural vêm de `i.ytimg.com`. Só são aceites links `https://`, `http://`, `mailto:` e `tel:`.
- **Pendente:** a CSP tem `style-src 'self'`, que bloqueia atributos `style="…"`, e os templates do tema ainda os usam (sobretudo `contacts.html` e `venue.html`). É preciso passá-los para CSS ou acrescentar `'unsafe-inline'` ao `style-src`.
- **Pendente:** o `partials/head.html` só define o `<title>`. O build já calcula `seo_description`, `canonical`, `alternates` (hreflang) e `og_image`, mas o template não os usa.
