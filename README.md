# Pinheiro Veículos

Site da loja com painel administrativo. Node 18+ e nenhuma dependência para instalar.

    npm start        # http://localhost:3000   (painel em /admin)

No primeiro start o servidor cria as equipes e os logins e imprime as senhas no terminal
(também em `data/credenciais-iniciais.txt`). Troque as senhas em Admin > Usuários e apague o arquivo.

## Estrutura de equipes
- **Administrador**: edita tudo (veículos, fotos, preços, odômetro, equipes, usuários, logo e dados do site).
- **Gerente** (superior da equipe): vê as propostas da própria equipe e distribui entre os membros.
  A equipe com "Gerencia estoque" (Vendas Seminovos) também edita veículos.
- **Membro da equipe**: vê e responde só as propostas atribuídas a ele.

O cliente escolhe, na página do veículo, qual equipe monta a proposta (compra, financiamento, troca, pós-venda).

## Dados
Tudo fica em `data/db.json`, e as fotos em `uploads/`. Faça backup dessas duas pastas.
Para publicar na internet use um servidor com Node e disco persistente (não serve hospedagem estática).
Coloque atrás de HTTPS (o cookie de sessão é HttpOnly e SameSite=Strict; ative `Secure` se usar proxy HTTPS).
