-- 2026-11-04 — backfill shows.tvmaze_type from TVMaze for rows left null (read by Claude from api.tvmaze.com/shows/{id}; stand alone mode reads the type).
update public.shows set tvmaze_type = 'Scripted' where id = '12monkeys' and tvmaze_type is null; -- 12 Monkeys
update public.shows set tvmaze_type = 'Scripted' where id = 'allinthefamily' and tvmaze_type is null; -- All in the Family
update public.shows set tvmaze_type = 'Variety' where id = 'allthat' and tvmaze_type is null; -- All That
update public.shows set tvmaze_type = 'Reality' where id = 'americandaredevils' and tvmaze_type is null; -- American Daredevils
update public.shows set tvmaze_type = 'Game Show' where id = 'apocalypsewow' and tvmaze_type is null; -- Apocalypse Wow
update public.shows set tvmaze_type = 'Scripted' where id = 'bb' and tvmaze_type is null; -- Breaking Bad
update public.shows set tvmaze_type = 'Reality' where id = 'bigbrother' and tvmaze_type is null; -- Big Brother
update public.shows set tvmaze_type = 'Animation' where id = 'bigmouth' and tvmaze_type is null; -- Big Mouth
update public.shows set tvmaze_type = 'Scripted' where id = 'bloodline' and tvmaze_type is null; -- Bloodline
update public.shows set tvmaze_type = 'Animation' where id = 'bojackhorseman' and tvmaze_type is null; -- BoJack Horseman
update public.shows set tvmaze_type = 'Scripted' where id = 'copythat' and tvmaze_type is null; -- Copy That?
update public.shows set tvmaze_type = 'Reality' where id = 'countingcars' and tvmaze_type is null; -- Counting Cars
update public.shows set tvmaze_type = 'Scripted' where id = 'dekalog' and tvmaze_type is null; -- Dekalog
update public.shows set tvmaze_type = 'Scripted' where id = 'eastofeden' and tvmaze_type is null; -- East of Eden
update public.shows set tvmaze_type = 'Scripted' where id = 'emergnciaradioativa' and tvmaze_type is null; -- Emergência Radioativa
update public.shows set tvmaze_type = 'Scripted' where id = 'enlightened' and tvmaze_type is null; -- Enlightened
update public.shows set tvmaze_type = 'Scripted' where id = 'everybodyhateschris' and tvmaze_type is null; -- Everybody Hates Chris
update public.shows set tvmaze_type = 'Scripted' where id = 'fourkings' and tvmaze_type is null; -- Four Kings
update public.shows set tvmaze_type = 'Scripted' where id = 'freaksandgeeks' and tvmaze_type is null; -- Freaks and Geeks
update public.shows set tvmaze_type = 'Scripted' where id = 'fridaynightlights' and tvmaze_type is null; -- Friday Night Lights
update public.shows set tvmaze_type = 'Scripted' where id = 'happy' and tvmaze_type is null; -- Happy!
update public.shows set tvmaze_type = 'Scripted' where id = 'househusbands' and tvmaze_type is null; -- House Husbands
update public.shows set tvmaze_type = 'Scripted' where id = 'imalanpartridge' and tvmaze_type is null; -- I'm Alan Partridge
update public.shows set tvmaze_type = 'Documentary' where id = 'mapman' and tvmaze_type is null; -- Map Man
update public.shows set tvmaze_type = 'Scripted' where id = 'mobland' and tvmaze_type is null; -- MobLand
update public.shows set tvmaze_type = 'Scripted' where id = 'mrshow' and tvmaze_type is null; -- Mr. Show
update public.shows set tvmaze_type = 'Scripted' where id = 'nypdblue' and tvmaze_type is null; -- NYPD Blue
update public.shows set tvmaze_type = 'Scripted' where id = 'oneday' and tvmaze_type is null; -- One Day
update public.shows set tvmaze_type = 'Scripted' where id = 'prideandprejudice' and tvmaze_type is null; -- Pride and Prejudice
update public.shows set tvmaze_type = 'Scripted' where id = 'route187' and tvmaze_type is null; -- Route 187
update public.shows set tvmaze_type = 'Scripted' where id = 'schittscreek' and tvmaze_type is null; -- Schitt's Creek
update public.shows set tvmaze_type = 'Scripted' where id = 'showmeahero' and tvmaze_type is null; -- Show Me a Hero
update public.shows set tvmaze_type = 'Scripted' where id = 'supermanlois' and tvmaze_type is null; -- Superman & Lois
update public.shows set tvmaze_type = 'Reality' where id = 'survivorqubec' and tvmaze_type is null; -- Survivor Québec
update public.shows set tvmaze_type = 'Documentary' where id = 'tedtalks' and tvmaze_type is null; -- TED Talks
update public.shows set tvmaze_type = 'Documentary' where id = 'thecivilwar' and tvmaze_type is null; -- The Civil War
update public.shows set tvmaze_type = 'Scripted' where id = 'theleftovers' and tvmaze_type is null; -- The Leftovers
update public.shows set tvmaze_type = 'Reality' where id = 'therealhousewivesofmiami' and tvmaze_type is null; -- The Real Housewives of Miami
update public.shows set tvmaze_type = 'Reality' where id = 'therealhousewivesofvancouver' and tvmaze_type is null; -- The Real Housewives of Vancouver
update public.shows set tvmaze_type = 'Scripted' where id = 'thesopranos' and tvmaze_type is null; -- The Sopranos
update public.shows set tvmaze_type = 'Scripted' where id = 'thewire' and tvmaze_type is null; -- The Wire
update public.shows set tvmaze_type = 'Scripted' where id = 'theyoungindianajoneschronicles' and tvmaze_type is null; -- The Young Indiana Jones Chronicles
update public.shows set tvmaze_type = 'Scripted' where id = 'three' and tvmaze_type is null; -- Three
update public.shows set tvmaze_type = 'Scripted' where id = 'threerivers' and tvmaze_type is null; -- Three Rivers
update public.shows set tvmaze_type = 'Reality' where id = 'topchef' and tvmaze_type is null; -- Top Chef
update public.shows set tvmaze_type = 'Scripted' where id = 'two' and tvmaze_type is null; -- Two
update public.shows set tvmaze_type = 'Documentary' where id = 'unsolvedmysteries' and tvmaze_type is null; -- Unsolved Mysteries
update public.shows set tvmaze_type = 'Scripted' where id = 'uphere' and tvmaze_type is null; -- Up Here
