-- =============================================================================
-- Windfall Planner — schéma PostgreSQL du serveur de synchronisation
-- =============================================================================
-- RT_70 : persistance serveur (PostgreSQL), quatre tables : users,
--         device_tokens, records, idempotency_keys.
-- Contrat d'API : openapi.yml v1.1.0 (RT_67, RT_68, RT_69).
--
-- Le serveur ne fait que ranger, versionner et renvoyer les listes et
-- déploiements : leur contenu est stocké tel quel en JSONB. Seuls sont extraits
-- en colonnes les champs dont le serveur a besoin pour décider (RT_68) : la
-- liste d'un déploiement et son triplet (liste, disposition adverse, plateau).
--
-- Décision encore ouverte (spec.md, « Suivi des décisions non tranchées ») :
-- portée des identifiants d'enregistrement. Ce schéma retient l'hypothèse de
-- RT_70 — unicité par compte, clé (user_id, resource_type, id).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- users — un compte joueur (RG_50, RG_52, RT_70)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    -- RG_50 : email normalisé (espaces retirés, minuscules), jamais vérifié.
    -- RT_69 : 254 caractères au plus.
    email              varchar(254) NOT NULL,
    -- RT_67 : hash argon2id (format PHC, sel et paramètres inclus).
    password_hash      text         NOT NULL,
    -- RT_70 : compteur de révision du compte, part de 0 ; chaque écriture
    -- (création, modification, suppression) l'incrémente de 1.
    revision           bigint       NOT NULL DEFAULT 0,
    -- RT_70/RT_68 : plus haute révision de trace de suppression purgée ;
    -- un pull dont `since` est inférieur reçoit 410.
    purged_revision    bigint       NOT NULL DEFAULT 0,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT users_email_unique     UNIQUE (email),
    CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
    CONSTRAINT users_revision_positive CHECK (revision >= 0),
    CONSTRAINT users_purged_revision_bounds
        CHECK (purged_revision >= 0 AND purged_revision <= revision)
);

-- -----------------------------------------------------------------------------
-- device_tokens — jeton d'appareil permanent (RT_67, RG_53)
-- -----------------------------------------------------------------------------
-- Un jeton par appareil et par compte, sans expiration ni renouvellement.
-- Une nouvelle connexion du même appareil remplace son jeton précédent
-- (UPSERT sur (user_id, device_id)).
CREATE TABLE device_tokens (
    -- RT_67 : SHA-256 du jeton (256 bits aléatoires) ; jamais stocké en clair.
    token_hash         bytea        PRIMARY KEY,
    user_id            uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- RT_67 : UUID généré par le client à la première ouverture.
    device_id          uuid         NOT NULL,
    -- RT_67/RG_54 : libellé affiché dans les conflits (« Chrome — Windows »).
    device_name        varchar(80)  NOT NULL,
    device_platform    varchar(10)  NOT NULL,
    created_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT device_tokens_hash_length   CHECK (octet_length(token_hash) = 32),
    CONSTRAINT device_tokens_name_not_empty CHECK (char_length(device_name) >= 1),
    CONSTRAINT device_tokens_platform
        CHECK (device_platform IN ('android', 'ios', 'web')),
    CONSTRAINT device_tokens_user_device_unique UNIQUE (user_id, device_id)
);

-- -----------------------------------------------------------------------------
-- records — listes et déploiements, versionnés (RT_68, RT_70)
-- -----------------------------------------------------------------------------
-- Une suppression ne retire pas la ligne : elle la marque supprimée, vide son
-- contenu et lui donne une nouvelle révision (trace transmise au pull). Les
-- traces de plus de 90 jours sont purgées (users.purged_revision).
CREATE TABLE records (
    user_id                  uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    resource_type            varchar(10)  NOT NULL,
    -- RT_07/RT_69 : identifiant généré par le client (`list_<uuid>`, …).
    id                       varchar(100) NOT NULL,
    -- RT_70 : révision de la dernière écriture = `versionToken` du contrat.
    revision                 bigint       NOT NULL,
    deleted                  boolean      NOT NULL DEFAULT false,
    -- RT_70 : contenu complet tel que poussé (List ou Deployment d'openapi.yml,
    -- `createdAt`/`updatedAt` de l'appareil inclus, RT_68) ; NULL si supprimé.
    content                  jsonb,
    -- RT_68 : champs extraits pour les déploiements — liaison à la liste
    -- (immuable, RT_07) et triplet (RG_14) détectant un plateau créé deux fois.
    list_id                  varchar(100),
    opponent_disposition_id  varchar(100),
    board_id                 varchar(100),
    -- RG_54 : appareil auteur de cette révision, figé au moment de l'écriture
    -- (affiché dans les conflits même si l'appareil s'est reconnecté depuis).
    author_device_id         uuid         NOT NULL,
    author_device_name       varchar(80)  NOT NULL,
    author_device_platform   varchar(10)  NOT NULL,
    -- RT_70 : date (serveur) de la suppression, pour la purge à 90 jours.
    deleted_at               timestamptz,
    -- RT_68/RG_54 : date de la suppression fixée par l'appareil (`deletedAt`
    -- de la poussée), affichée dans les conflits ; NULL si l'appareil ne l'a
    -- pas transmise ou pour un enregistrement vivant.
    client_deleted_at        timestamptz,

    PRIMARY KEY (user_id, resource_type, id),

    CONSTRAINT records_resource_type
        CHECK (resource_type IN ('list', 'deployment')),
    CONSTRAINT records_id_not_empty CHECK (char_length(id) >= 1),
    CONSTRAINT records_revision_positive CHECK (revision > 0),
    CONSTRAINT records_author_platform
        CHECK (author_device_platform IN ('android', 'ios', 'web')),
    -- Supprimé ⇔ contenu vidé et date de suppression renseignée.
    CONSTRAINT records_deleted_consistency CHECK (
        (deleted AND content IS NULL AND deleted_at IS NOT NULL)
        OR (NOT deleted AND content IS NOT NULL AND deleted_at IS NULL
            AND client_deleted_at IS NULL)
    ),
    -- Seuls les déploiements portent une liste et un triplet ; un déploiement
    -- vivant les porte tous les trois.
    CONSTRAINT records_deployment_columns CHECK (
        (resource_type = 'list'
            AND list_id IS NULL
            AND opponent_disposition_id IS NULL
            AND board_id IS NULL)
        OR (resource_type = 'deployment'
            AND list_id IS NOT NULL
            AND (deleted
                 OR (opponent_disposition_id IS NOT NULL AND board_id IS NOT NULL)))
    )
);

-- RT_70 : pull — enregistrements du compte dont la révision dépasse `since`,
-- par révision croissante, paginés. La révision est unique au sein d'un compte.
CREATE UNIQUE INDEX records_user_revision_idx
    ON records (user_id, revision);

-- RT_70/RT_68 : cascade de suppression d'une liste (RG_21) et détection du
-- triplet en double (RG_14).
CREATE INDEX records_user_list_idx
    ON records (user_id, list_id)
    WHERE resource_type = 'deployment';

-- RT_70 : purge des traces de suppression de plus de 90 jours.
CREATE INDEX records_deleted_at_idx
    ON records (deleted_at)
    WHERE deleted;

-- -----------------------------------------------------------------------------
-- idempotency_keys — réponses rejouables des poussées et résolutions (RT_68)
-- -----------------------------------------------------------------------------
-- Une requête rejouée avec la même clé renvoie la réponse initiale. Purgées
-- après 24 heures (RT_70).
CREATE TABLE idempotency_keys (
    user_id            uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- RT_68 : en-tête Idempotency-Key (UUID généré par le client).
    key                uuid         NOT NULL,
    -- Empreinte (SHA-256) du corps : la même clé avec un autre corps est
    -- une erreur du client, pas un rejeu.
    request_hash       bytea        NOT NULL,
    response_status    smallint     NOT NULL,
    response_body      jsonb        NOT NULL,
    created_at         timestamptz  NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, key),

    CONSTRAINT idempotency_keys_hash_length CHECK (octet_length(request_hash) = 32)
);

-- RT_70 : purge des clés de plus de 24 heures.
CREATE INDEX idempotency_keys_created_at_idx
    ON idempotency_keys (created_at);

COMMIT;

-- =============================================================================
-- Opérations de maintenance (RT_70), à exécuter périodiquement
-- =============================================================================
--
-- Purge des traces de suppression de plus de 90 jours, en retenant la plus
-- haute révision purgée par compte :
--
--   WITH purged AS (
--       DELETE FROM records
--       WHERE deleted AND deleted_at < now() - interval '90 days'
--       RETURNING user_id, revision
--   )
--   UPDATE users u
--   SET purged_revision = GREATEST(u.purged_revision, p.max_revision)
--   FROM (SELECT user_id, max(revision) AS max_revision
--         FROM purged GROUP BY user_id) p
--   WHERE u.id = p.user_id;
--
-- Purge des clés d'idempotence de plus de 24 heures :
--
--   DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';
--
-- Suppression d'un compte (RG_52) — immédiate et totale, en une transaction ;
-- les ON DELETE CASCADE emportent device_tokens, records et idempotency_keys :
--
--   DELETE FROM users WHERE id = $1;
--
-- Poussée (RT_70, « Concurrence ») — verrouiller la ligne du compte pour que
-- deux poussées du même compte ne s'entrelacent pas, puis incrémenter le
-- compteur à chaque écriture :
--
--   SELECT revision FROM users WHERE id = $1 FOR UPDATE;
--   UPDATE users SET revision = revision + 1 WHERE id = $1 RETURNING revision;
