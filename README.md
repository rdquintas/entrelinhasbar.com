# entrelinhasbar.com (estático, pt/en)

Site estático alojado no **Netlify**. Todo o conteúdo vive em ficheiros **YAML** e em imagens no repositório Git; cada `commit` na branch principal dispara um deploy automático. Sem backend, sem base de dados, sem segredos.

- **Build:** Node.js (`build.js`) gera o HTML final em `dist/` — o site publicado não lê YAML no browser.
- **Imagens:** as originais ficam em `src/images/` e são convertidas automaticamente para **AVIF** (com fallback WebP) em várias larguras.
- **Edição:** diretamente nos YAML ou através do **[Pages CMS](https://pagescms.org)** (formulários, já configurados em `.pages.yml`).

## Estrutura

```
content/     YAML editáveis (site, index, agenda, mural, contactos)
src/images/  imagens originais (só as referenciadas nos YAML são processadas)
src/templates/  HTML (páginas + partials/header, footer, head, carousel)
src/css, src/js, src/static   CSS, JS e ficheiros copiados tal como estão (favicon)
lib/         módulos do build (conteúdo, eventos, imagens, templates)
scripts/     clean-images.js (limpeza) e fetch-placeholders.js (imagens de teste)
.pages.yml   configuração do Pages CMS
.github/workflows/limpar-imagens.yml   remove imagens de eventos apagados
```

## Como editar o conteúdo

### Textos nos dois idiomas
Cada texto tem uma versão por idioma:

```yaml
titulo:
  pt: "Bem-vindo"
  en: "Welcome"
```

Se faltar uma tradução, o site usa o idioma por defeito (pt) e o build mostra um aviso. Texto com várias linhas: uma linha em branco cria um novo parágrafo. Não se usa HTML.

### Ficheiros
| Ficheiro | O que controla |
|---|---|
| `content/site.yaml` | nome, idiomas, menu, logótipo, redes sociais, textos de botões (`ui`), `url_base` |
| `content/index.yaml` | hero por defeito, até 10 imagens de galeria, vídeo YouTube |
| `content/agenda.yaml` | hero e lista de eventos |
| `content/mural.yaml` | hero e itens (imagens ou vídeos YouTube, sem limite) |
| `content/contactos.yaml` | hero, contactos, horário, link do Google Maps, FAQ |

### Eventos (`content/agenda.yaml`)
- Podem estar por **qualquer ordem**: o site ordena-os por data e hora.
- `data: "2026-11-14"` (AAAA-MM-DD, com aspas) e `hora: "21:30"` (HH:MM, 24 h, com aspas).
- `destaque: true` → o evento aparece no **carrossel** da página inicial (no lugar do hero; máx. 5). Sem destaques, mostra o hero por defeito.
- `cancelado: true` → faixa vermelha **CANCELADO** no evento, na agenda e no carrossel.
- `ativo: false` → o evento **não aparece em lado nenhum** (nem tem página), mas continua no YAML e as suas imagens mantêm-se.
- **Apagar** o evento do YAML remove-o do site **e** apaga as suas imagens do repositório (ver [Limpeza de imagens](#limpeza-de-imagens-de-eventos-apagados)).
- O endereço do evento é gerado a partir do título: `Tuba ao Vivo` → `/event/tuba-ao-vivo/` (em inglês: `/en/event/tuba-ao-vivo/`). Se mudares o título depois de partilhares o link, o endereço muda; para o fixar, preenche o campo opcional `slug`.
- Cada evento tem uma imagem **horizontal** (obrigatória) e uma **vertical** (opcional, usada em telemóvel); até 5 `links`; `youtube` opcional (URL ou ID).

### Imagens
1. Põe o ficheiro original em `src/images/` (jpg, png, webp, tiff, gif, avif; SVG e GIFs animados são copiados sem conversão). **Tamanho máximo: 15 MB** — recomenda-se redimensionar antes (lado maior até ~2400 px).
2. Referencia-o no YAML apenas pelo nome:

```yaml
imagem_horizontal:
  ficheiro: concerto.jpg
  alt: { pt: "Palco ao fim da tarde", en: "Stage at sunset" }
```

O `alt` descreve a imagem para quem não a vê (recomendado). Nos eventos, se faltar, usa-se o título. **Nunca** referencies ficheiros `.avif` gerados: o build decide os nomes finais.

### Hero (todas as páginas)
Cada página tem `hero.horizontal` (computador/tablet) e `hero.vertical` (telemóvel, até 768 px). Se não houver vertical, usa-se a horizontal.

## Ajustar a qualidade e as larguras das imagens
No topo de `lib/images.js` há um único objeto `CONFIG`:

| Opção | Valor por defeito |
|---|---|
| `widths` | `[480, 960, 1600]` (nunca amplia o original) |
| `avifQuality` / `avifEffort` | `50` / `4` |
| `webpFallback` | `true` (põe `false` para servir só AVIF) |
| `webpQuality` | `75` |
| `maxFileBytes` | 15 MB |

O build **falha** (com o nome do ficheiro) se uma imagem estiver corrompida, não existir ou exceder o limite. No fim mostra quantas imagens foram processadas, quantas vieram da cache e a poupança de tamanho.

## Adicionar um idioma
1. Em `content/site.yaml`, acrescenta em `idiomas` (`codigo`, `nome`, `locale`).
2. Acrescenta a nova chave (ex.: `es:`) em **todos** os textos dos YAML (incluindo `ui`, `menu` e eventos). O que faltar usa o idioma por defeito e o build avisa.
3. Para o Pages CMS, acrescenta também o campo do novo idioma nos blocos `components` de `.pages.yml` (`texto`, `texto_longo`, `imagem`…).

O idioma por defeito (`idioma_padrao`) fica na raiz (`/`, `/agenda/`…); os outros têm prefixo (`/en/`, `/en/agenda/`…). Os URLs, o seletor de idioma, o `hreflang` e o sitemap são gerados a partir da lista de idiomas.

## Adicionar uma página
1. Cria `content/nova.yaml` (nome em minúsculas, sem acentos) com pelo menos `titulo` e `hero`:
   ```yaml
   titulo: { pt: "Sobre nós", en: "About us" }
   hero:
     horizontal: { ficheiro: sobre.jpg, alt: { pt: "…", en: "…" } }
   texto: { pt: "…", en: "…" }
   ```
2. Cria `src/templates/nova.html` (copia `contactos.html` e simplifica; o texto multilinha usa `{{para texto}}`).
3. Acrescenta `- pagina: nova` (com `label`) ao `menu` de `content/site.yaml`.

A página fica em `/nova/` (idioma por defeito, na raiz) e `/en/nova/`.

### Sintaxe dos templates
`{{campo}}` texto · `{{{html}}}` HTML gerado pelo build · `{{img campo preset=card}}` imagem · `{{hero}}` hero · `{{para campo}}` texto multilinha · `{{#each lista}}…{{/each}}` · `{{#if x}}…{{else}}…{{/if}}` · `{{> partial}}`. Se uma chave não existir no conteúdo, o build falha a indicar qual.

## Fluxo de trabalho
1. Editar YAML/imagens (à mão ou no Pages CMS).
2. `commit` + `push` na branch principal.
3. O Netlify corre `npm run build` e publica `dist/`.
4. **Se o build falhar** (YAML inválido, imagem em falta, data errada…), o Netlify **não publica** e mantém o deploy anterior online. A mensagem de erro indica ficheiro, chave e como corrigir (Netlify → *Deploys* → build falhado → log).

## Testar localmente
```bash
npm install
npm run build        # gera dist/
npx serve dist       # abre http://localhost:3000/
```
(`netlify dev` também serve.) Para (re)gerar as imagens de teste: `npm run placeholders` (descarrega do placehold.co) ou `npm run placeholders -- --local` (gera sem rede).

## Netlify: configuração inicial
1. Cria o repositório (GitHub) e faz push deste projeto.
2. Netlify → *Add new site* → *Import from Git* → escolhe o repositório. O `netlify.toml` já define o comando (`npm run build`), a pasta (`dist`) e o Node 22.
3. Em `content/site.yaml`, define `url_base` com o endereço final (ex.: `https://meusite.netlify.app`) e faz push.
4. **Ativa as notificações de deploy falhado** (Netlify → *Project configuration* → *Notifications* → *Deploy failed*): quem edita pelo CMS não vê o log do Netlify.
5. O idioma por defeito é servido na raiz (`/`); os links antigos `/pt/...` redirecionam (301) para `/...` (`dist/_redirects`, gerado pelo build).

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
- Compara o `agenda.yaml` **anterior** com o **atual**. Só apaga imagens que **eram de eventos** e **já não são referenciadas em lado nenhum** (nenhum YAML).
- **Não** apaga: imagens de eventos com `ativo: false`; imagens partilhadas com outro conteúdo (outro evento, hero, mural…); uploads recentes ainda por associar a um evento (nunca se faz um varrimento geral de `src/images/`).
- **Atenção:** se trocares a imagem de um evento por outra, a imagem antiga também é apagada (deixa de estar referenciada).
- **Limite de segurança:** se mais de 20 imagens fossem apagadas de uma vez, aborta sem apagar nada e o job falha (visível no separador *Actions*). Para forçar localmente: `npm run clean-images -- --before <commit> --max <N>`.
- Para ver o que seria apagado: `npm run clean-images -- --before HEAD~1 --dry`.
- Se a branch principal não se chamar `main`, altera o workflow. Se a branch tiver proteção que bloqueie pushes do bot, permite-os (ou desativa a proteção para o `github-actions[bot]`).
- **Apagar ficheiros não reduz o histórico do Git:** os ficheiros antigos continuam nos commits anteriores, por isso o `.git` não encolhe. Redimensiona as imagens antes de as carregar.

## Notas
- **Eventos passados** não são escondidos automaticamente: ficam na agenda até serem apagados (ou `ativo: false`). Eventos com `destaque: true` ficam no carrossel até desmarcares o destaque.
- Segurança: cabeçalhos e CSP no `netlify.toml` (sem scripts/estilos inline). Vídeos via `youtube-nocookie.com`; as miniaturas do mural vêm de `i.ytimg.com`. Só são aceites links `https://`, `http://`, `mailto:` e `tel:`.
- O CSS é propositadamente mínimo e funcional (sem estética): quando escolheres o tema, substitui `src/css/style.css` e ajusta as classes dos templates.
