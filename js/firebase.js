(() => {
  window.ManchaApp = window.ManchaApp || {};
        var de = null;
        function Ee() {
          return (
            de ||
            (window.firebase &&
              window.__FIREBASE_CONFIG__ &&
              window.__FIREBASE_CONFIG__.apiKey &&
              (window.firebase.apps.length ||
                window.firebase.initializeApp(window.__FIREBASE_CONFIG__),
              (de = window.firebase.database())),
            de)
          );
        }
        function U(e, t) {
          let l = Ee();
          return l
            ? l
                .ref("pes/" + e)
                .set(t === void 0 ? null : t)
                .catch((a) => console.error("firebase set failed", e, a))
            : Promise.resolve();
        }
        const sharedValueListeners = new Map();
        function Q(e, t) {
          let l = Ee();
          if (!l) return (t(null), () => {});
          let path = "pes/" + e;
          let entry = sharedValueListeners.get(path);
          if (!entry) {
            let ref = l.ref(path);
            entry = {
              ref,
              subscribers: new Set(),
              hasValue: false,
              value: null,
              handler: null,
            };
            entry.handler = (snapshot) => {
              entry.value = snapshot.val();
              entry.hasValue = true;
              entry.subscribers.forEach((subscriber) => subscriber(entry.value));
            };
            ref.on("value", entry.handler);
            sharedValueListeners.set(path, entry);
          }
          entry.subscribers.add(t);
          if (entry.hasValue) t(entry.value);
          return () => {
            let current = sharedValueListeners.get(path);
            if (!current) return;
            current.subscribers.delete(t);
            if (current.subscribers.size === 0) {
              current.ref.off("value", current.handler);
              sharedValueListeners.delete(path);
            }
          };
        }
        const IDENTITY_SCHEMA_VERSION = 4;
        let identityMigrationPromise = null;
        function normalizeIdentityText(value) {
          return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
        }
        function stableIdentityId(prefix, seed) {
          let input = `${prefix}:${normalizeIdentityText(seed) || "legacy"}`;
          let hash = 2166136261;
          for (let index = 0; index < input.length; index++) {
            hash ^= input.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
          }
          return `${prefix}_${(hash >>> 0).toString(36)}`;
        }
        function migrateStableIdentitySchema() {
          if (identityMigrationPromise) return identityMigrationPromise;
          let db = Ee();
          if (!db) return Promise.resolve(false);
          identityMigrationPromise = db.ref("pes").transaction((rootValue) => {
            let root = rootValue && typeof rootValue === "object" ? { ...rootValue } : {};
            let meta = root.meta && typeof root.meta === "object" ? { ...root.meta } : {};
            if (Number(meta.identitySchemaVersion || 0) >= IDENTITY_SCHEMA_VERSION) return;
            let rawProfiles = Array.isArray(root.profiles) ? root.profiles.filter(Boolean) : [];
            let knownProfileIds = new Set(rawProfiles.filter((profile) => profile && typeof profile === "object" && profile.id).map((profile) => String(profile.id)));
            let recoveryCandidates = new Map();
            // Perfis ausentes não são mais recriados automaticamente a partir de times.
            // A recuperação só roda quando explicitamente habilitada no meta pelo administrador.
            if (meta.recoverMissingProfiles === true) {
              (Array.isArray(root.tournaments) ? root.tournaments : []).forEach((tournament) => {
                if (!tournament || typeof tournament !== "object") return;
                let context = tournament.context && typeof tournament.context === "object" ? tournament.context : {};
                (Array.isArray(context.teams) ? context.teams : []).forEach((team) => {
                  if (!team || typeof team !== "object" || !team.profileId) return;
                  let profileId = String(team.profileId);
                  if (knownProfileIds.has(profileId) || recoveryCandidates.has(profileId)) return;
                  let recoveredName = String(team.archivedProfileName || team.profileName || team.ownerName || team.managerName || team.name || "Perfil recuperado").trim();
                  recoveryCandidates.set(profileId, {
                    id: profileId,
                    name: recoveredName,
                    color: team.profileColor || team.color || "#58cc02",
                    avatar: team.profileAvatar || team.avatar || null,
                    role: team.profileRole === "admin" ? "admin" : "player",
                    active: true,
                    recoveredFromTournament: true,
                    recoveredAt: Date.now(),
                  });
                });
              });
              if (recoveryCandidates.size) rawProfiles = [...rawProfiles, ...recoveryCandidates.values()];
              meta.recoverMissingProfiles = false;
            }
            let usedProfileIds = new Set();
            let profiles = rawProfiles.map((raw, index) => {
              let source = raw && typeof raw === "object" ? { ...raw } : { name: String(raw || "").trim() };
              let seed = source.id || source.name || `profile-${index}`;
              let id = String(source.id || stableIdentityId("profile", seed));
              while (usedProfileIds.has(id)) id = stableIdentityId("profile", `${seed}-${index}`);
              usedProfileIds.add(id);
              return { ...source, id, name: String(source.name || `Perfil ${index + 1}`).trim(), active: source.active !== false };
            });
            let profileById = new Map(profiles.map((profile) => [String(profile.id), profile]));
            let profilesByName = new Map();
            profiles.forEach((profile) => {
              let key = normalizeIdentityText(profile.name);
              if (!profilesByName.has(key)) profilesByName.set(key, []);
              profilesByName.get(key).push(profile);
            });
            let tournaments = Array.isArray(root.tournaments) ? root.tournaments.map((tournament, tournamentIndex) => {
              if (!tournament || typeof tournament !== "object") return tournament;
              let nextTournament = { ...tournament };
              let context = nextTournament.context && typeof nextTournament.context === "object" ? { ...nextTournament.context } : {};
              let rawTeams = Array.isArray(context.teams) ? context.teams : [];
              let usedTeamIds = new Set();
              let teams = rawTeams.map((rawTeam, teamIndex) => {
                let team = rawTeam && typeof rawTeam === "object" ? { ...rawTeam } : { name: String(rawTeam || "").trim() };
                let seed = team.id || `${nextTournament.id || tournamentIndex}-${team.name || teamIndex}`;
                let id = String(team.id || stableIdentityId("team", seed));
                while (usedTeamIds.has(id)) id = stableIdentityId("team", `${seed}-${teamIndex}`);
                usedTeamIds.add(id);
                let profileId = team.profileId && profileById.has(String(team.profileId)) ? String(team.profileId) : null;
                if (!profileId) {
                  let directProfile = profiles.find((profile) => profile.teamId && String(profile.teamId) === id);
                  if (directProfile) profileId = directProfile.id;
                }
                if (!profileId) {
                  let matches = profilesByName.get(normalizeIdentityText(team.archivedProfileName || team.name)) || [];
                  if (matches.length === 1) profileId = matches[0].id;
                }
                return { ...team, id, profileId: profileId || null };
              });
              let teamById = new Map(teams.map((team) => [String(team.id), team]));
              let teamByProfileId = new Map(teams.filter((team) => team.profileId).map((team) => [String(team.profileId), team]));
              let participantIds = [];
              let addParticipant = (value) => {
                if (value == null) return;
                let token = String(value);
                let profileId = profileById.has(token) ? token : null;
                if (!profileId && teamById.has(token)) profileId = teamById.get(token).profileId;
                if (!profileId) {
                  let matches = profilesByName.get(normalizeIdentityText(token)) || [];
                  if (matches.length === 1) profileId = matches[0].id;
                }
                if (profileId && !participantIds.includes(profileId)) participantIds.push(profileId);
              };
              (Array.isArray(nextTournament.participants) ? nextTournament.participants : []).forEach(addParticipant);
              (Array.isArray(nextTournament.teamIds) ? nextTournament.teamIds : []).forEach((teamId) => {
                let team = teamById.get(String(teamId));
                if (team && team.profileId) addParticipant(team.profileId);
              });
              profiles.forEach((profile) => {
                if (Array.isArray(profile.tournamentIds) && profile.tournamentIds.includes(nextTournament.id)) addParticipant(profile.id);
              });
              teams.forEach((team) => {
                if (team.active !== false && team.profileId) addParticipant(team.profileId);
              });
              let activeTeamIds = teams.filter((team) => team.active !== false && team.profileId && participantIds.includes(team.profileId)).map((team) => team.id);
              let matches = Array.isArray(context.matches) ? context.matches.map((match) => {
                if (!match || typeof match !== "object") return match;
                let homeTeam = teamById.get(String(match.homeId || match.homeTeamId || ""));
                let awayTeam = teamById.get(String(match.awayId || match.awayTeamId || ""));
                return { ...match, homeId: match.homeId || match.homeTeamId || null, awayId: match.awayId || match.awayTeamId || null, homeTeamId: match.homeTeamId || match.homeId || null, awayTeamId: match.awayTeamId || match.awayId || null, homeProfileId: match.homeProfileId || (homeTeam && homeTeam.profileId) || null, awayProfileId: match.awayProfileId || (awayTeam && awayTeam.profileId) || null };
              }) : [];
              let tradeOffers = context.tradeOffers && typeof context.tradeOffers === "object" ? Object.fromEntries(Object.entries(context.tradeOffers).map(([offerId, offer]) => {
                if (!offer || typeof offer !== "object") return [offerId, offer];
                let buyerTeam = teamById.get(String(offer.buyerTeamId || ""));
                let sellerTeam = teamById.get(String(offer.sellerTeamId || ""));
                return [offerId, { ...offer, buyerProfileId: offer.buyerProfileId || (buyerTeam && buyerTeam.profileId) || null, sellerProfileId: offer.sellerProfileId || (sellerTeam && sellerTeam.profileId) || null }];
              })) : {};
              return { ...nextTournament, participants: participantIds, teamIds: activeTeamIds, context: { ...context, teams, matches, tradeOffers } };
            }) : [];
            root.profiles = profiles;
            root.tournaments = tournaments;
            root.meta = { ...meta, identitySchemaVersion: IDENTITY_SCHEMA_VERSION, identityMigratedAt: Date.now() };
            return root;
          }).then((result) => !!(result && result.committed)).catch((error) => {
            identityMigrationPromise = null;
            console.error("stable identity migration failed", error);
            return false;
          });
          return identityMigrationPromise;
        }

  Object.assign(window.ManchaApp, { Ee, U, Q, normalizeIdentityText, stableIdentityId, migrateStableIdentitySchema, IDENTITY_SCHEMA_VERSION });
})();
