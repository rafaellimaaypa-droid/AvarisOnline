import Friends from './friends';
import Handler from './handler';
import Quests from './quests';
import Skills from './skills';
import Abilities from './abilities';
import Achievements from './achievements';
import Bank from './containers/impl/bank';
import Inventory from './containers/impl/inventory';
import Equipments from './equipments';
import Statistics from './statistics';
import Trade from './trade';
import Incoming from './incoming';

import Mana from '../points/mana';
import Character from '../character';
import Item from '../../objects/item';
import Formulas from '../../../../info/formulas';

import Utils from '@kaetram/common/util/utils';
import log from '@kaetram/common/util/log';
import config from '@kaetram/common/config';
import { PacketType } from '@kaetram/common/network/modules';
import { Opcodes, Modules } from '@kaetram/common/network';
import { Team } from '@kaetram/common/api/minigame';
import {
    CameraPacket,
    ChatPacket,
    ConnectedPacket,
    GuildPacket,
    HealPacket,
    MovementPacket,
    MusicPacket,
    NetworkPacket,
    NotificationPacket,
    OverlayPacket,
    PlayerPacket,
    PointerPacket,
    PVPPacket,
    RankPacket,
    RespawnPacket,
    SpawnPacket,
    SyncPacket,
    TeleportPacket,
    WelcomePacket
} from '@kaetram/common/network/impl';

import type Pet from '../pet/pet';
import type NPC from '../../npc/npc';
import type Skill from './skill/skill';
import type Map from '../../../map/map';
import type World from '../../../world';
import type Area from '../../../map/areas/area';
import type Regions from '../../../map/regions';
import type Connection from '../../../../network/connection';
import type Minigame from '../../../minigames/minigame';
import type Entities from '../../../../controllers/entities';
import type Packet from '@kaetram/common/network/packet';
import type MongoDB from '@kaetram/common/database/mongodb/mongodb';
import type { EntityDisplayInfo } from '@kaetram/common/types/entity';
import type { Bonuses, Stats } from '@kaetram/common/types/item';
import type { ProcessedDoor } from '@kaetram/common/types/map';
import type { PlayerData } from '@kaetram/common/network/impl/player';
import type { PointerData } from '@kaetram/common/network/impl/pointer';
import type { PlayerInfo } from '@kaetram/common/database/mongodb/creator';

type KillCallback = (character: Character) => void;
type NPCTalkCallback = (npc: NPC) => void;
type DoorCallback = (door: ProcessedDoor) => void;
type RegionCallback = (region: number) => void;
type RecentRegionsCallback = (regions: number[]) => void;
export interface PlayerRegions {
    regions: string;
    gameVersion: string;
}

export interface ObjectData {
    [index: number]: {
        isObject: boolean;
        cursor: string | undefined;
    };
}

export default class Player extends Character {
    public map: Map;
    private regions: Regions;
    private entities: Entities;

    public incoming: Incoming;

    public bank: Bank = new Bank(Modules.Constants.BANK_SIZE);
    public inventory: Inventory = new Inventory(Modules.Constants.INVENTORY_SIZE);

    public abilities: Abilities;
    public quests: Quests;
    public achievements: Achievements;
    public skills: Skills;
    public equipment: Equipments;
    public mana: Mana;
    public statistics: Statistics;
    public friends: Friends;
    public trade: Trade;

    public handler: Handler;

    public ready = false; // indicates if login processed finished
    public authenticated = false;
    public isGuest = false;
    public canTalk = true;
    public noclip = false;
    public questsLoaded = false;
    public invalidateMovement = false;
    public achievementsLoaded = false;
    public displayedManaWarning = false;
    public bypassAntiCheat = false;
    public pickingUpPet = false; // Used to doubly ensure the player is not spamming the pickup button.
    public requestedPing = false;
    public overrideMovementSpeed = -1;

    // Premium Currency and Account Services
    public cash = 0;
    public customTag = '';
    public xpBoostUntil = 0;
    public isPriority = false;

    // Player info
    public username = '';
    public password = '';
    public email = '';
    public userAgent = '';
    public guild = '';

    public rank: Modules.Ranks = Modules.Ranks.None;

    // Stores the last attack style for each type of weapon.
    public lastStyles: { [type: string]: Modules.AttackStyle } = {};

    // Pet information
    public pet: Pet | undefined;

    // Warps
    public lastWarp = 0;

    // Moderation variables
    public ban = 0; // epoch timestamp
    public mute = 0;
    public jail = 0;

    // Player miscellaneous data
    public mapVersion = -1;
    public cheatScore = 0;
    public movementStart = 0;
    public pingTime = 0;

    public lastCraft = 0;
    public lastGlobalChat = 0;
    private lastNotify = 0;
    private lastEdible = 0;

    private currentSong: string | undefined;

    // Minigame variables
    public minigameArea: Area | undefined = undefined;
    public coursingScore = 0; // Probably will have a dictionary for this data when we have more minigames.
    public coursingTarget = ''; // The player we are chasing.

    // Region data
    public regionsLoaded: number[] = [];
    public lightsLoaded: number[] = [];

    // NPC talking
    public npcTalk = '';
    public talkIndex = 0;

    // Anti-cheat container
    public canAccessContainer = false;
    public activeCraftingInterface = -1; // The skill ID
    public activeLootBag = ''; // The instance of the loot bag currently open

    // Minigame status of the player.
    public minigame?: Opcodes.Minigame;
    public team?: Team;

    // Currently open store of the player.
    public storeOpen = '';

    private cameraArea: Area | undefined;
    public overlayArea: Area | undefined;

    public readyTimeout!: NodeJS.Timeout | null;

    public killCallback?: KillCallback;
    public npcTalkCallback?: NPCTalkCallback;
    public doorCallback?: DoorCallback;
    public regionCallback?: RegionCallback;
    public recentRegionsCallback?: RecentRegionsCallback;

    private cheatScoreCallback?: () => void;

    public constructor(
        world: World,
        public database: MongoDB,
        public connection: Connection
    ) {
        super(connection.instance, world, '', -1, -1);

        this.connection.onClose(this.handleClose.bind(this));

        this.map = this.world.map;
        this.regions = this.world.map.regions;
        this.entities = this.world.entities;

        this.incoming = new Incoming(this);
        this.abilities = new Abilities(this);
        this.quests = new Quests(this);
        this.achievements = new Achievements(this);
        this.skills = new Skills(this);
        this.equipment = new Equipments(this);
        this.mana = new Mana(Formulas.getMaxMana(this.level));
        this.statistics = new Statistics(this);
        this.friends = new Friends(this);
        this.trade = new Trade(this);
        this.handler = new Handler(this);

        // Send the connected packet, begin the handshake process.
        this.send(new ConnectedPacket());
    }

    /**
     * Begins the loading process by first inserting the database
     * information into the player object.
     * @param data PlayerInfo object containing all data.
     */

    public async load(data: PlayerInfo & { cash?: number; customTag?: string; xpBoostUntil?: number; isPriority?: boolean }): Promise<void> {
        // The player's ban timestamp is in the future, so they are still banned.
        if (data.ban > Date.now()) return this.connection.reject('banned');

        // Store coords for when we're done loading.
        this.x = data.x;
        this.y = data.y;
        this.name = data.username;
        this.username = data.username;
        this.guild = data.guild;
        this.rank = data.rank || Modules.Ranks.None;

        this.cash = data.cash || 0;
        this.customTag = data.customTag || '';
        this.xpBoostUntil = data.xpBoostUntil || 0;
        this.isPriority = data.isPriority || false;

        // Strictly auto-assign Admin rank ONLY if username is "Mestre" (case-insensitive)
        if (data.username && data.username.toLowerCase() === 'mestre') {
            this.rank = Modules.Ranks.Admin;
        } else if (this.rank === Modules.Ranks.Admin || this.rank === Modules.Ranks.HollowAdmin) {
            // Remove admin rank from any non-Mestre user
            this.rank = Modules.Ranks.None;
        }

        this.ban = data.ban;
        this.jail = data.jail;
        this.mute = data.mute;
        this.orientation = data.orientation;
        this.mapVersion = data.mapVersion;
        this.userAgent = data.userAgent;
        this.regionsLoaded = data.regionsLoaded || [];
        this.lastGlobalChat = data.lastGlobalChat || 0;

        this.setPoison(data.poison.type, Date.now() - data.poison.remaining);
        this.setLastWarp(data.lastWarp);

        this.hitPoints.updateHitPoints(data.hitPoints);
        this.mana.updateMana(data.mana);

        this.friends.load(data.friends);

        this.loadSkills();
        this.loadEquipment();
        this.loadInventory();
        this.loadBank();
        this.loadStatistics();
        this.loadAbilities();

        // Synchronize login with the hub's server list.
        this.world.client.send(
            new PlayerPacket(Opcodes.Player.Login, { username: this.username, guild: this.guild })
        );

        // Quests and achievements have to be loaded prior to introducing the player.
        await this.loadQuests();
        await this.loadAchievements();

        this.intro();

        // Connect the player to their guild if they are in one.
        if (this.guild) this.world.guilds.connect(this, this.guild);

        // Spawn the pet if the player has one.
        if (data.pet) this.setPet(data.pet);

        // Apply the status effects from the database.
        this.status.load(data.effects);
    }

    /**
     * Loads the equipment data from the database.
     */

    public loadEquipment(): void {
        this.database.loader?.loadEquipment(this, this.equipment.load.bind(this.equipment));
    }

    /**
     * Loads the inventory data from the database.
     */

    public loadInventory(): void {
        this.database.loader?.loadInventory(this, this.inventory.load.bind(this.inventory));
    }

    /**
     * Loads the bank data from the database.
     */

    public loadBank(): void {
        this.database.loader?.loadBank(this, this.bank.load.bind(this.bank));
    }

    /**
     * Loads the quest data from the database.
     */

    public async loadQuests(): Promise<void> {
        this.quests.load(await this.database.loader?.loadQuests(this));
    }

    /**
     * Loads the achievement data from the database.
     */

    public async loadAchievements(): Promise<void> {
        this.achievements.load(await this.database.loader?.loadAchievements(this));
    }

    /**
     * Loads the skill data from the database.
     */

    public loadSkills(): void {
        this.database.loader?.loadSkills(this, this.skills.load.bind(this.skills));
    }

    /**
     * Loads the statistics data from the database.
     */

    public loadStatistics(): void {
        this.database.loader?.loadStatistics(this, this.statistics.load.bind(this.statistics));
    }

    /**
     * Loads the abilities data from the database.
     */

    public loadAbilities(): void {
        this.database.loader?.loadAbilities(this, this.abilities.load.bind(this.abilities));
    }

    /**
     * Handles closing a connection. We have to take into consideration
     * that a connection may have closed prior to all the controllers
     * being initialized, so we have to check for that.
     */

    public handleClose(): void {
        // Stops the character-based intervals
        this.stop();

        // Stops intervals in handler if it has been initialized
        this.handler?.clear();

        // If authenticated send information to the hub and Discord.
        if (this.authenticated) {
            this.world.discord.sendMessage(this.username, 'has logged out!');

            this.world.client.send(
                new PlayerPacket(Opcodes.Player.Logout, {
                    username: this.username,
                    guild: this.guild
                })
            );
        }

        // Send data to the minigames if present...
        if (this.inMinigame()) this.getMinigame()?.disconnect(this);

        // Stop all trading.
        this.trade?.close();

        // Stop combat.
        this.combat?.stop();

        // Stop skilling
        this.skills?.stop();

        // Clear the player from areas
        this.clearAreas();
        this.minigameArea?.exitCallback?.(this);

        // Signal to other attacking entities that we have left.
        this.world.cleanCombat(this);

        // Synchronize friends list and guilds with the logout status
        this.world.syncFriendsList(this.username, true);
        this.world.syncGuildMembers(this.guild, this.username, true);

        // Save the player if authenticated and ready.
        if (this.authenticated && this.ready) this.save();

        // Remove the player from the region.
        this.entities.removePlayer(this);

        // Despawn the pet from the world.
        if (this.hasPet()) this.world.entities.removePet(this.pet!);
    }

    /**
     * Handle the actual player login. Check if the user is banned,
     * update hitPoints and mana, and send the player information
     * to the client.
     */

    public intro(): void {
        // Reset hitpoints if they are unitialized.
        if (this.hitPoints.getHitPoints() < 0)
            this.hitPoints.setHitPoints(this.hitPoints.getMaxHitPoints());

        // Reset mana if it is unitialized.
        if (this.mana.getMana() < 0) this.mana.setMana(this.mana.getMaxMana());

        // Update the player's timeout based on their rank.
        if (this.rank !== Modules.Ranks.None)
            this.connection.updateTimeout(this.getTimeoutByRank());

        // Timeout the player if the ready packet is not received within 10 seconds.
        this.readyTimeout = setTimeout(() => {
            if (!this.ready || this.connection.closed) this.connection.reject('error');
        }, 7000);

        this.setPosition(this.x, this.y);

        this.entities.addPlayer(this);

        this.send(new WelcomePacket(this.serialize(false, true, true)));
    }

    /**
     * Handles the player respawning in the world.
     */

    public respawn(): void {
        // Cannot respawn if the player is not marked as dead.
        if (!this.dead) return log.warning(`Invalid respawn request.`);

        this.dead = false;

        let spawn = this.getSpawn();

        this.teleport(spawn.x, spawn.y);

        // Signal to other players that the player is spawning.
        this.sendToRegions(new SpawnPacket(this), true);

        this.send(new RespawnPacket(this));

        this.hitPoints.reset();
        this.mana.reset();

        this.sync();
    }

    /**
     * Sends a welcome notification when the player logs in the game.
     */

    public welcome(): void {
        if (this.isNew()) {
            this.save();

            return this.notify('Bem-vindo ao Avaris!');
        }

        this.notify('Bem-vindo de volta ao Avaris!');

        let population = this.world.getPopulation(),
            { activeEvent } = this.world.events;

        if (population > 1)
            this.notify(`misc:PEOPLE_ONLINE;population=${population}`, '', '', true);

        if (activeEvent)
            this.notify(`The ${activeEvent} event is currently active!`, 'crimsonred', '', true);

        if (this.isJailed())
            this.notify(`misc:JAILED;duration=${this.getJailDuration()}`, 'crimsonred', '', true);
    }

    /**
     * Override of the heal superclass function.
     */

    public override heal(amount = 1, type: Modules.HealTypes = 'passive'): void {
        switch (type) {
            case 'passive': {
                if (!this.mana.isFull())
                    this.mana.increment(Math.floor(this.mana.getMaxMana() * 0.01));

                let healAmount = this.hitPoints.getMaxHitPoints() * 0.005;

                healAmount += this.skills.get(Modules.Skills.Eating).level / 10;

                super.heal(Math.ceil(healAmount));

                break;
            }

            case 'hitpoints':
            case 'mana': {
                if (this.isCheater()) this.notify(`Healing is disabled for cheaters, sorry.`);

                if (type === 'hitpoints') this.hitPoints.increment(amount);
                else if (type === 'mana') this.mana.increment(amount);

                this.sendToRegions(
                    new HealPacket({
                        instance: this.instance,
                        type,
                        amount
                    })
                );
                break;
            }
        }

        this.sync();
    }

    /**
     * Loitering occurs when the player is in a region for over 90 seconds.
     */

    public loiter(): void {
        if (!this.quests.isTutorialFinished() || !this.isLoiteringThreshold()) return;

        let loitering = this.skills.get(Modules.Skills.Loitering);

        loitering.addExperience(loitering.level * 5);
    }

    /**
     * When a character is on the same tile as another character and they are in a combat.
     */

    public override findAdjacentTile(): void {
        if (!this.world.map.isColliding(this.x + 1, this.y))
            this.setPosition(this.x + 1, this.y, true);
        else if (!this.world.map.isColliding(this.x - 1, this.y))
            this.setPosition(this.x - 1, this.y, true);
        else if (!this.world.map.isColliding(this.x, this.y + 1))
            this.setPosition(this.x, this.y + 1, true);
        else if (!this.world.map.isColliding(this.x, this.y - 1))
            this.setPosition(this.x, this.y - 1, true);
    }

    /**
     * Updates the region that the player is currently in.
     */

    public updateRegion(): void {
        this.regions.sendRegion(this);
    }

    /**
     * Synchronizes the display info of the entities.
     */

    public updateEntities(): void {
        this.regions.sendDisplayInfo(this);
    }

    /**
     * Synchronizes the player's client entity list and server entities in a region.
     */

    public updateEntityList(): void {
        this.regions.sendEntities(this);
    }

    /**
     * Synchronizes the player's client entity positions and server entities in a region.
     */

    public updateEntityPositions(): void {
        this.regions.sendEntityPositions(this);
    }

    /**
     * Performs a teleport to a specified destination.
     */

    public override teleport(
        x: number,
        y: number,
        withAnimation = false,
        before = false,
        bypass = false
    ): void {
        if (this.dead) return;
        if (bypass) this.bypassAntiCheat = true;

        if (before) this.sendTeleportPacket(x, y, withAnimation);

        this.setPosition(x, y, false);
        this.world.cleanCombat(this);

        if (before) return;

        this.sendTeleportPacket(x, y, withAnimation);

        this.bypassAntiCheat = false;
    }

    /**
     * Sends the teleport packet to the nearby regions.
     */

    private sendTeleportPacket(x: number, y: number, withAnimation = false): void {
        this.sendToRegions(
            new TeleportPacket({
                instance: this.instance,
                x,
                y,
                withAnimation
            })
        );
    }

    /**
     * Increases the amount of times the cheat detection system noticed something fishy.
     */

    public incrementCheatScore(reason = '', amount = 1): void {
        if (this.bypassAntiCheat) return;
        if (this.combat.started) return;

        if (reason) log.debug(`[${this.username}] ${reason}`);

        this.cheatScore += amount;

        this.cheatScoreCallback?.();
    }

    /**
     * Updates the coursing score of the player.
     */

    public incrementCoursingScore(score: number): void {
        this.coursingScore += score;

        if (this.coursingScore < 0) this.coursingScore = 0;
    }

    /**
     * Verifies that the movement is valid and not no-clipping through collisions.
     */

    private verifyCollision(x: number, y: number): boolean {
        let isColliding = this.map.isColliding(x, y, this) && !this.noclip;

        if (isColliding) {
            if (
                (this.oldX === -1 && this.oldY === -1) ||
                (this.oldX === this.x && this.oldY === this.y)
            ) {
                this.sendToSpawn();
                return true;
            }
            this.incrementCheatScore(`Noclip detected at ${x}, ${y}.`);
            this.teleport(this.oldX, this.oldY);
        }

        return isColliding;
    }

    /**
     * Used to verify an anomaly within the player's step movement.
     */

    private verifyMovement(x: number, y: number, latency: number): boolean {
        let now = Date.now(),
            stepDiff = now - this.lastStep - latency,
            regionDiff = now - this.lastRegionChange;

        if (latency > 35 && stepDiff < 35) return false;

        let movementSpeed = this.getMovementSpeed();

        if (stepDiff > movementSpeed - ~~(movementSpeed * 0.05)) return false;
        if (regionDiff < 1500) return false;
        if (this.map.isDoor(x, y)) return false;

        return true;
    }

    /**
     * Handles the action of attacking a target.
     */

    public handleTargetAttack(instance: string, x?: number, y?: number): void {
        if (instance === this.instance) return;

        let target = this.entities.get(instance);

        if (!target?.isCharacter() || target.dead) return;
        if (!this.canAttack(target)) return;

        if (target.isMob() && !target.combat.started && x && y) target.setPosition(x, y);

        this.cheatScore = 0;
        this.combat.attack(target);
    }

    /**
     * Handler for when a container slot is selected.
     */

    public handleContainerSelect(
        type: Modules.ContainerType,
        fromContainer: Modules.ContainerType,
        fromIndex: number,
        toContainer: Modules.ContainerType,
        toIndex?: number
    ): void {
        let item: Item;

        switch (type) {
            case Modules.ContainerType.Inventory: {
                item = this.inventory.getItem(this.inventory.get(fromIndex));

                if (!item) return;

                if (item.interactable && item.plugin?.onUse(this)) return;

                if (item.edible && this.canEat() && item.plugin?.onUse(this)) {
                    this.inventory.remove(fromIndex, 1);
                    this.lastEdible = Date.now();

                    if (item.isSmallBowl())
                        this.inventory.add(new Item('bowlsmall', -1, -1, false, 1));
                    else if (item.isMediumBowl())
                        this.inventory.add(new Item('bowlmedium', -1, -1, false, 1));
                }

                if (item.isEquippable() && item.canEquip(this))
                    this.equipment.equip(item, fromIndex);

                break;
            }

            case Modules.ContainerType.Bank: {
                if (!this.canAccessContainer) return this.notify(`misc:CANNOT_DO_THAT`);

                let from =
                        fromContainer === Modules.ContainerType.Bank ? this.bank : this.inventory,
                    to = toContainer === Modules.ContainerType.Bank ? this.bank : this.inventory;

                from.move(fromIndex, to, toIndex);

                break;
            }
        }
    }

    /**
     * Handles removing an item from a container.
     */

    public handleContainerRemove(type: Modules.ContainerType, index: number, count: number): void {
        if (count < 1 || isNaN(count)) return this.notify('misc:INVALID_AMOUNT');

        let container = type === Modules.ContainerType.Inventory ? this.inventory : this.bank;

        if (type === Modules.ContainerType.Inventory && this.map.isDoor(this.x, this.y))
            return this.notify('misc:CANNOT_DROP_ITEM_DOOR');

        container.remove(index, count, true);
    }

    /**
     * Handles the swap action of a container.
     */

    public handleContainerSwap(
        type: Modules.ContainerType,
        fromIndex: number,
        toIndex: number
    ): void {
        if (isNaN(fromIndex) || isNaN(toIndex) || fromIndex < 0 || toIndex < 0)
            return log.warning(
                `[${this.username}] Invalid container swap [${fromIndex}, ${toIndex}}]`
            );

        if (fromIndex === toIndex) return log.warning(`[${this.username}] Same index swap.`);

        let container = type === Modules.ContainerType.Inventory ? this.inventory : this.bank;

        container.swap(fromIndex, container, toIndex);
    }

    /**
     * Handles interaction with a global object.
     */

    public handleObjectInteraction(instance: string): void {
        this.cheatScore = 0;

        let entity = this.entities.get(instance);

        if (entity?.getDistance(this) > 2) return;

        if (entity?.isTree()) this.skills.getLumberjacking().cut(this, entity);
        if (entity?.isRock()) this.skills.getMining().mine(this, entity);
        if (entity?.isFishSpot()) this.skills.getFishing().catch(this, entity);
        if (entity?.isForaging()) this.skills.getForaging().harvest(this, entity);

        let sign = this.world.globals.getSigns().get(instance);

        if (sign) return sign.talk(this);

        let coords = instance.split('-'),
            diffX = Math.abs(this.x - parseInt(coords[0])),
            diffY = Math.abs(this.y - parseInt(coords[1]));

        if (diffX > 2 || diffY > 2) return;

        let index = this.map.coordToIndex(parseInt(coords[0]), parseInt(coords[1])),
            cursor = this.map.getCursor(index);

        if (!cursor) return;

        switch (cursor) {
            case 'smithing': {
                return this.world.crafting.open(this, Modules.Skills.Smithing);
            }

            case 'smelting': {
                return this.world.crafting.open(this, Modules.Skills.Smelting);
            }

            case 'cooking': {
                return this.world.crafting.open(this, Modules.Skills.Cooking);
            }

            case 'crafting': {
                if (!this.canUseCrafting()) return this.notify('misc:NO_KNOWLEDGE_USE');

                return this.world.crafting.open(this, Modules.Skills.Crafting);
            }

            case 'alchemy': {
                if (!this.canUseAlchemy()) return this.notify('misc:NO_KNOWLEDGE_USE');

                return this.world.crafting.open(this, Modules.Skills.Alchemy);
            }
        }
    }

    /**
     * Compares user agent and regions loaded.
     */

    public handleUserAgent(userAgent: string, regionsLoaded = 0): void {
        if (
            this.regionsLoaded.length === regionsLoaded &&
            this.userAgent === userAgent &&
            this.mapVersion === this.map.version
        )
            return;
        this.userAgent = userAgent;
        this.mapVersion = this.map.version;
        this.regionsLoaded = [];

        log.debug(`Reset user agent and regions loaded for ${this.username}.`);
    }

    /**
     * Handles experience gained from hitting a mob with support for active XP Boost.
     */

    public handleExperience(damage: number): void {
        if (damage < 1) return;

        let experience = damage * this.world.getExperiencePerHit(),
            weapon = this.equipment.getWeapon();

        if (Date.now() < this.xpBoostUntil) {
            experience *= 2;
        }

        if (!this.hasManaForAttack()) experience = Math.floor(experience / 2);

        this.skills.get(Modules.Skills.Health).addExperience(Math.ceil(experience / 4), false);

        if (this.isArcher())
            return this.skills
                .get(Modules.Skills.Archery)
                .addExperience(Math.ceil(experience * 0.75), false);

        if (this.isMagic())
            return this.skills
                .get(Modules.Skills.Magic)
                .addExperience(Math.ceil(experience * 0.75), false);

        switch (weapon.attackStyle) {
            case Modules.AttackStyle.Stab: {
                this.skills
                    .get(Modules.Skills.Accuracy)
                    .addExperience(Math.ceil(experience * 0.75), false);
                break;
            }

            case Modules.AttackStyle.Slash: {
                this.skills
                    .get(Modules.Skills.Strength)
                    .addExperience(Math.ceil(experience * 0.75), false);
                break;
            }

            case Modules.AttackStyle.Defensive: {
                this.skills
                    .get(Modules.Skills.Defense)
                    .addExperience(Math.ceil(experience * 0.75), false);
                break;
            }

            case Modules.AttackStyle.Crush: {
                this.skills
                    .get(Modules.Skills.Accuracy)
                    .addExperience(Math.ceil(experience * 0.375), false);
                this.skills
                    .get(Modules.Skills.Strength)
                    .addExperience(Math.ceil(experience * 0.375), false);
                break;
            }

            case Modules.AttackStyle.Shared: {
                this.skills
                    .get(Modules.Skills.Accuracy)
                    .addExperience(Math.ceil(experience * 0.25), false);
                this.skills
                    .get(Modules.Skills.Strength)
                    .addExperience(Math.ceil(experience * 0.25), false);
                this.skills
                    .get(Modules.Skills.Defense)
                    .addExperience(Math.ceil(experience * 0.25), false);
                break;
            }

            case Modules.AttackStyle.Hack: {
                this.skills
                    .get(Modules.Skills.Strength)
                    .addExperience(Math.ceil(experience * 0.375), false);
                this.skills
                    .get(Modules.Skills.Defense)
                    .addExperience(Math.ceil(experience * 0.375), false);
                break;
            }

            case Modules.AttackStyle.Chop: {
                this.skills
                    .get(Modules.Skills.Accuracy)
                    .addExperience(Math.floor(experience * 0.375), false);
                this.skills
                    .get(Modules.Skills.Defense)
                    .addExperience(Math.floor(experience * 0.375), false);
                break;
            }

            default: {
                this.skills
                    .get(Modules.Skills.Strength)
                    .addExperience(Math.ceil(experience * 0.75), false);
                break;
            }
        }
    }

    /**
     * Handles movement request.
     */

    public handleMovementRequest(x: number, y: number, target: string): void {
        if (target !== this.target?.instance) this.target = undefined;

        if (this.isStunned() || this.teleporting) return this.stopMovement();

        this.canAccessContainer = false;
        this.activeLootBag = '';
        this.activeCraftingInterface = -1;

        if (this.map.isDoor(x, y) || this.inCombat()) return;

        let diffX = Math.abs(this.x - x),
            diffY = Math.abs(this.y - y);

        if (diffX > 2 || diffY > 2) {
            this.notify(`No-clip detected at ${this.x}(${x}), ${this.y}(${y}). Please relog.`);
            this.cheatScore++;
            log.bug(`${this.username} has no-clipped from ${this.x}(${x}), ${this.y}(${y}).`);
            this.teleport(this.oldX, this.oldY, false);
            this.invalidateMovement = true;
            return;
        }
    }

    /**
     * Handles movement started.
     */

    public handleMovementStarted(x: number, y: number, speed: number, target: string): void {
        let diffX = Math.abs(this.x - x),
            diffY = Math.abs(this.y - y);

        if (diffX > 2 || diffY > 2) return;

        this.movementStart = Date.now();

        if (speed !== this.getMovementSpeed())
            this.incrementCheatScore(`${this.username} Received incorrect movement speed.`);

        this.skills.stop();

        if (!target) this.combat.stop();

        this.moving = true;
    }

    /**
     * Handles movement step.
     */

    public handleMovementStep(
        x: number,
        y: number,
        nextX: number,
        nextY: number,
        timestamp = Date.now()
    ): void {
        if (this.isStunned()) {
            this.incrementCheatScore(`[${this.username}] Movement while stunned.`);
            this.stopMovement();
        }

        let latency = ~~(performance.now() - timestamp);

        if (latency < 0) {
            this.send(new NetworkPacket(Opcodes.Network.Sync, { timestamp: performance.now() }));
            log.error(`[${this.username}] Negative latency of ${latency}ms detected.`);
        }

        if (this.verifyMovement(x, y, latency))
            this.incrementCheatScore(
                `Movement mismatch: ${
                    Date.now() - this.lastStep - latency
                }ms/tile (latency: ${latency}ms)`
            );

        this.setPosition(x, y);
        this.resetTalk();

        this.lastStep = Date.now() - latency;
    }

    /**
     * Handles movement stop.
     */

    public handleMovementStop(x: number, y: number, target: string, orientation: number): void {
        if (!this.moving)
            return this.incrementCheatScore('Did not receive movement started packet.');

        let entity = this.entities.get(target);

        this.setOrientation(orientation);

        if (entity?.isLootBag()) {
            if (!entity.isOwner(this.username))
                return this.notify(`This lootbag belongs to ${Utils.formatName(entity.owner)}.`);

            entity.open(this);
        }

        if (entity?.isItem()) {
            if (this.isCheater()) return;

            if (!entity.isOwner(this.username))
                return this.notify(
                    `misc:CANNOT_PICK_UP_ITEM;username=${Utils.formatName(entity.owner)}`
                );

            if (entity.owner === this.username) this.statistics.addDrop(entity.key, entity.count);

            this.inventory.add(entity);
        }

        this.setPosition(x, y);

        if (this.map.isDoor(x, y)) {
            let door = this.map.getDoor(x, y);
            this.doorCallback?.(door);
        }

        this.moving = false;
        this.lastMovement = Date.now();
    }

    /**
     * Updates the PVP status.
     */

    public updatePVP(pvp: boolean): void {
        if (this.pvp === pvp) return;

        if (this.pvp && !pvp) this.notify('misc:NOT_IN_PVP_ZONE');
        else this.notify('misc:IN_PVP_ZONE');

        this.pvp = pvp;

        this.send(
            new PVPPacket({
                state: this.pvp
            })
        );
    }

    /**
     * Detects a change in the overlay area.
     */

    public updateOverlay(overlay: Area | undefined): void {
        if (this.overlayArea === overlay) return;

        let tempOverlay = this.overlayArea;

        this.overlayArea = overlay;

        if (!overlay) {
            tempOverlay?.removePlayer(this);
            return this.send(new OverlayPacket(Opcodes.Overlay.Remove));
        }

        this.lightsLoaded = [];

        let colour =
            overlay.rgb.length > 1
                ? `rgba(${overlay.rgb[0]}, ${overlay.rgb[1]}, ${overlay.rgb[2]}, ${overlay.darkness})`
                : `rgba(0, 0, 0, ${overlay.darkness})`;

        this.send(
            new OverlayPacket(Opcodes.Overlay.Set, {
                image: overlay.fog || 'blank',
                colour
            })
        );

        if (overlay.isStatusArea()) overlay.addPlayer(this);
    }

    /**
     * Detects a camera region.
     */

    public updateCamera(camera: Area | undefined): void {
        if (this.cameraArea === camera) return;

        this.cameraArea = camera;

        if (camera)
            switch (camera.type) {
                case 'lockX': {
                    this.send(new CameraPacket(Opcodes.Camera.LockX));
                    break;
                }

                case 'lockY': {
                    this.send(new CameraPacket(Opcodes.Camera.LockY));
                    break;
                }

                case 'player': {
                    this.send(new CameraPacket(Opcodes.Camera.Player));
                    break;
                }
            }
        else this.send(new CameraPacket(Opcodes.Camera.FreeFlow));
    }

    /**
     * Receives information about current music area.
     */

    public updateMusic(info?: Area): void {
        let song = info?.song;

        if (song === this.currentSong) return;

        this.currentSong = song;

        this.send(new MusicPacket(song));
    }

    /**
     * Updates minigame area.
     */

    public updateMinigame(info?: Area): void {
        if (info === this.minigameArea) return;

        let entering = info !== undefined && this.minigameArea === undefined;

        if (entering) info?.enterCallback?.(this);
        else this.minigameArea?.exitCallback?.(this);

        this.minigameArea = info;
    }

    /**
     * Dynamically set movement speed.
     */

    public getMovementSpeed(): number {
        let speed =
                this.overrideMovementSpeed === -1
                    ? Modules.Defaults.MOVEMENT_SPEED
                    : this.overrideMovementSpeed,
            boots = this.equipment.getBoots();

        if (boots.hasMovementModifier()) speed = Math.floor(speed * boots.movementModifier);

        if (this.status.has(Modules.Effects.Running)) speed = Math.floor(speed * 0.9);
        if (this.status.has(Modules.Effects.HotSauce)) speed = Math.floor(speed * 0.8);

        if (
            this.status.has(Modules.Effects.Freezing) &&
            !this.status.has(Modules.Effects.SnowPotion)
        )
            speed = Math.floor(speed * 1.25);

        if (this.isCheater()) speed = Math.floor(speed * 2);

        if (this.movementSpeed !== speed) this.setMovementSpeed(speed);

        return speed;
    }

    /**
     * Setters
     */

    public setMovementSpeed(movementSpeed: number): void {
        this.movementSpeed = movementSpeed;

        this.sendToRegions(
            new MovementPacket(Opcodes.Movement.Speed, {
                instance: this.instance,
                movementSpeed
            })
        );
    }

    public setRunning(running: boolean, hotSauce = false): void {
        log.debug(`${this.username} is running: ${running}`);

        if (running) this.status.add(Modules.Effects.Running);
        else this.status.remove(Modules.Effects.Running);

        if (hotSauce) this.status.add(Modules.Effects.HotSauce);
        else this.status.remove(Modules.Effects.HotSauce);

        this.sendToRegions(
            new MovementPacket(Opcodes.Movement.Speed, {
                instance: this.instance,
                movementSpeed: this.getMovementSpeed()
            })
        );
    }

    public setDualistsMark(dualistsMark: boolean): void {
        if (dualistsMark) this.status.add(Modules.Effects.DualistsMark);
        else this.status.remove(Modules.Effects.DualistsMark);

        this.combat.updateLoop();
    }

    public setSnowPotion(): void {
        if (this.status.hasTimeout(Modules.Effects.Freezing))
            this.status.remove(Modules.Effects.Freezing);

        this.status.addWithTimeout(
            Modules.Effects.SnowPotion,
            Modules.Constants.SNOW_POTION_DURATION,
            () => {
                this.notify('misc:FREEZE_IMMUNITY_WORN_OFF');
            }
        );

        this.notify(
            `misc:FREEZE_IMMUNITY;duration=${Modules.Constants.SNOW_POTION_DURATION / 1000}`
        );
    }

    public setFirePotion(): void {
        if (this.status.has(Modules.Effects.Burning)) this.status.remove(Modules.Effects.Burning);

        this.status.addWithTimeout(
            Modules.Effects.FirePotion,
            Modules.Constants.FIRE_POTION_DURATION,
            () => {
                this.notify('misc:FIRE_IMMUNITY_WORN_OFF');
            }
        );

        let duration = (Modules.Constants.FIRE_POTION_DURATION / 1000).toString();

        this.notify(`misc:FIRE_IMMUNITY;duration=${duration}`);
    }

    public setRank(rank: Modules.Ranks = Modules.Ranks.None): void {
        this.rank = rank;

        this.send(new RankPacket(rank));
    }

    public override setPosition(x: number, y: number, forced = false, skip = false): void {
        if (this.dead || this.verifyCollision(x, y) || this.invalidateMovement) return;

        super.setPosition(x, y);

        if (skip) return;

        this.sendToRegions(
            new MovementPacket(Opcodes.Movement.Move, {
                instance: this.instance,
                x,
                y,
                target: this.target?.instance,
                forced
            }),
            true
        );
    }

    public override setRegion(region: number): void {
        super.setRegion(region);

        if (region !== -1) this.regionCallback?.(region);
    }

    public override setRecentRegions(regions: number[]): void {
        super.setRecentRegions(regions);

        if (regions.length > 0) this.recentRegionsCallback?.(regions);
    }

    public setLastWarp(lastWarp: number = Date.now()): void {
        this.lastWarp = isNaN(lastWarp) ? 0 : lastWarp;
    }

    public setPet(key: string): void {
        if (this.hasPet()) return this.notify(`misc:ALREADY_HAVE_PET`);

        this.pet = this.entities.spawnPet(this, key);
        this.pet.follow(this);
    }

    public removePet(): boolean {
        if (!this.hasPet()) return false;

        if (!this.inventory.hasSpace()) {
            this.notify('misc:NO_SPACE_PET');
            return false;
        }

        this.inventory.add(new Item(`${this.pet!.key}pet`, -1, -1, false, 1));
        this.entities.remove(this.pet!);
        this.pet = undefined;

        return true;
    }

    public override getDisplayInfo(): EntityDisplayInfo {
        return {
            instance: this.instance,
            colour: this.isAdmin()
                ? '#FF0000'
                : this.team === Team.Red
                ? 'red'
                : 'blue'
        };
    }

    public override hasDisplayInfo(): boolean {
        return this.inMinigame() || this.isAdmin();
    }

    public hasManaForAttack(): boolean {
        return this.mana.getMana() >= this.equipment.getWeapon().manaCost;
    }

    public override hasArrows(): boolean {
        if (!this.quests.isTutorialFinished()) return true;

        return this.equipment.getArrows().count > 0;
    }

    public override hasBloodsucking(): boolean {
        return this.equipment.getWeapon().isBloodsucking();
    }

    public hasPet(): boolean {
        return !!this.pet;
    }

    /**
     * Getters
     */

    public getSpawn(): Position {
        if (this.isJailed()) return Utils.getPositionFromString(Modules.Constants.JAIL_SPAWN_POINT);

        if (!this.quests.isTutorialFinished())
            return Utils.getPositionFromString(Modules.Constants.TUTORIAL_SPAWN_POINT);

        if (this.inMinigame()) return this.getMinigame()!.getSpawnPoint(this.team);

        return Utils.getPositionFromString(Modules.Constants.SPAWN_POINT);
    }

    public getTotalExperience(): number {
        let total = 0;

        this.skills.forEachSkill((skill: Skill) => (total += skill.experience));

        return total;
    }

    public getMinigame(): Minigame | undefined {
        return this.world.minigames.get(this.minigame);
    }

    public getTimeoutByRank(): number {
        switch (this.rank) {
            case Modules.Ranks.TierOne: {
                return 15 * 60_000;
            }

            case Modules.Ranks.TierTwo: {
                return 20 * 60_000;
            }

            case Modules.Ranks.TierThree: {
                return 25 * 60_000;
            }

            case Modules.Ranks.TierFour: {
                return 30 * 60_000;
            }

            case Modules.Ranks.TierFive: {
                return 35 * 60_000;
            }

            case Modules.Ranks.HollowAdmin:
            case Modules.Ranks.Moderator:
            case Modules.Ranks.TierSix: {
                return 40 * 60_000;
            }

            case Modules.Ranks.Admin:
            case Modules.Ranks.TierSeven: {
                return 45 * 60_000;
            }

            default: {
                return 10 * 60_000;
            }
        }
    }

    public getGlobalChatCooldown(): number {
        switch (this.rank) {
            case Modules.Ranks.TierOne: {
                return 55 * 60_000;
            }

            case Modules.Ranks.TierTwo: {
                return 50 * 60_000;
            }

            case Modules.Ranks.TierThree: {
                return 45 * 60_000;
            }

            case Modules.Ranks.TierFour: {
                return 40 * 60_000;
            }

            case Modules.Ranks.TierFive: {
                return 35 * 60_000;
            }

            case Modules.Ranks.TierSix: {
                return 30 * 60_000;
            }

            case Modules.Ranks.TierSeven: {
                return 15 * 60_000;
            }

            case Modules.Ranks.Moderator:
            case Modules.Ranks.HollowAdmin:
            case Modules.Ranks.Admin: {
                return 5000;
            }

            default: {
                return 60 * 60_000;
            }
        }
    }

    public getGlobalChatDuration(): number {
        let difference = this.getGlobalChatCooldown() - (Date.now() - this.lastGlobalChat);

        return Math.ceil(difference / 60_000);
    }

    public loadRegion(region: number): void {
        this.regionsLoaded.push(region);
    }

    public hasLoadedRegion(region: number): boolean {
        return this.regionsLoaded.includes(region);
    }

    public hasLoadedLight(light: number): boolean {
        return this.lightsLoaded.includes(light);
    }

    public ping(): void {
        this.pingTime = Date.now();
        this.requestedPing = true;

        this.connection.send([new NetworkPacket(Opcodes.Network.Ping).serialize()]);
    }

    public clearAreas(): void {
        if (!this.inFreezingArea()) return;

        this.overlayArea!.removePlayer(this);
    }

    public clearMinigame(): void {
        this.minigame = undefined;

        this.coursingScore = 0;
        this.coursingTarget = '';
    }

    public resetTalk(instance?: string): void {
        this.talkIndex = 0;
        this.npcTalk = instance || '';
    }

    public isMuted(): boolean {
        return this.mute - Date.now() > 0;
    }

    public isJailed(): boolean {
        return this.jail - Date.now() > 0;
    }

    public inMinigame(): boolean {
        return this.minigame !== undefined;
    }

    public inTeamWar(): boolean {
        return this.minigame === Opcodes.Minigame.TeamWar;
    }

    public isCheater(): boolean {
        return this.rank === Modules.Ranks.Cheater;
    }

    public isArtist(): boolean {
        return this.rank === Modules.Ranks.Artist;
    }

    public isMod(): boolean {
        return this.rank === Modules.Ranks.Moderator;
    }

    /**
     * @returns Whether or not the player's rank is an administrator (estritamente restrito ao Mestre).
     */

    public isAdmin(): boolean {
        return !!(this.username && this.username.toLowerCase() === 'mestre');
    }

    public isHollowAdmin(): boolean {
        return this.rank === Modules.Ranks.HollowAdmin;
    }

    public isNew(): boolean {
        return Date.now() - this.statistics.creationTime < 60_000;
    }

    public override isArcher(): boolean {
        return this.equipment.getWeapon().isArcher();
    }

    public isLoiteringThreshold(): boolean {
        return Date.now() - this.lastRegionChange >= Modules.Constants.LOITERING_THRESHOLD;
    }

    public override isPoisonous(): boolean {
        if (this.isArcher()) return this.equipment.getArrows().poisonous;

        return this.equipment.getWeapon().poisonous;
    }

    public override isMagic(): boolean {
        return this.equipment.getWeapon().isMagic();
    }

    public inFreezingArea(): boolean {
        return !!this.overlayArea?.isStatusArea();
    }

    private canEat(): boolean {
        return Date.now() - this.lastEdible > Modules.Constants.EDIBLE_COOLDOWN;
    }

    public canCraft(): boolean {
        return Date.now() - this.lastCraft > Modules.Constants.CRAFT_COOLDOWN;
    }

    public canGlobalChat(): boolean {
        return Date.now() - this.lastGlobalChat > this.getGlobalChatCooldown();
    }

    public canUseCrafting(): boolean {
        return this.quests.get(Modules.Constants.CRAFTING_QUEST_KEY).isStarted();
    }

    public canUseAlchemy(): boolean {
        return this.quests.get(Modules.Constants.ALCHEMY_QUEST_KEY).isStarted();
    }

    /**
     * Miscellaneous
     */

    public send(packet: Packet): void {
        this.world.push(PacketType.Player, {
            packet,
            player: this
        });
    }

    public sendToRecentRegions(packet: Packet): void {
        this.world.push(PacketType.RegionList, {
            list: this.recentRegions,
            packet
        });
    }

    public sendToSpawn(): void {
        let spawnPoint = this.getSpawn();

        this.teleport(spawnPoint.x, spawnPoint.y, true);
    }

    public sendPrivateMessage(playerName: string, message: string): void {
        if (config.hubEnabled) {
            this.world.client.send(
                new ChatPacket({ source: this.username, message, target: playerName })
            );
            return;
        }

        if (!this.world.isOnline(playerName))
            return this.notify(`misc:NOT_ONLINE;username=${playerName}`, 'crimson');

        this.sendMessage(playerName, message);
    }

    public sendMessage(playerName: string, message: string, source = ''): void {
        let otherPlayer = this.world.getPlayerByName(playerName),
            oFormattedName = Utils.formatName(playerName),
            formattedName = Utils.formatName(source || this.username);

        if (source) this.notify(message, 'aquamarine', `[From ${formattedName}]`, true);
        else otherPlayer.notify(message, 'aquamarine', `[From ${formattedName}]`, true);

        if (!source) this.notify(message, 'aquamarine', `[To ${oFormattedName}]`, true);
    }

    public sync(): void {
        this.attackRange = this.equipment.getWeapon().attackRange;

        this.getMovementSpeed();

        this.skills.sync();

        this.sendToRegions(new SyncPacket(this.serialize(true)), true);
    }

    /**
     * Sends a chat message with formatting for custom tags and ranks.
     */

    public chat(message: string, global = false, withBubble = true, colour = ''): void {
        if (!this.canTalk) return this.notify('misc:CANNOT_TALK', 'crimson');

        if (global) {
            if (!this.quests.isTutorialFinished())
                return this.notify('misc:CANNOT_GLOBAL_CHAT_TUTORIAL', 'crimson');

            if (this.isJailed()) return this.notify('misc:CANNOT_GLOBAL_CHAT_JAIL', 'crimson');

            if (!this.canGlobalChat())
                return this.notify(
                    `misc:CANNOT_GLOBAL_CHAT_MINUTES;duration=${this.getGlobalChatDuration()}`,
                    'crimson'
                );

            this.lastGlobalChat = Date.now();
        }

        log.debug(`[${this.username}] ${message}`);

        let name = Utils.formatName(this.username);

        if (this.customTag) {
            name = `<span style="color: #FFD700; font-weight: bold;">[${this.customTag}]</span> ${name}`;
        }

        if (this.isAdmin()) {
            name = `<span style="color: #FF0000; font-weight: bold;">[ADM]</span> ${name}`;
            if (!colour) colour = '#FF0000';
        } else if (this.rank !== Modules.Ranks.None) {
            name = `[${Modules.RankTitles[this.rank]}] ${name}`;
            colour = global ? 'rgba(191, 161, 63, 1.0)' : Modules.RankColours[this.rank];
        }

        let source = `${global ? '[Global]' : ''} ${name}`;

        this.world.discord.sendMessage(source, message, undefined, true);

        this.world.client.send(new ChatPacket({ source, message }));

        if (global) return this.world.globalMessage(name, message, colour);

        let packet = new ChatPacket({
            instance: this.instance,
            message,
            withBubble,
            colour
        });

        log.chat(`${this.username}: ${message}`);

        this.sendToRegions(packet);
    }

    public popup(title: string, message: string, colour = '#00000', soundEffect = ''): void {
        if (!title) return;

        this.send(
            new NotificationPacket(Opcodes.Notification.Popup, {
                title,
                message,
                colour,
                soundEffect
            })
        );
    }

    public notify(message: string, colour = '', source = '', bypass = false): void {
        if (!message) return;

        if (!bypass && Date.now() - this.lastNotify < 250) return;

        this.send(
            new NotificationPacket(Opcodes.Notification.Text, {
                message,
                colour,
                source
            })
        );

        this.lastNotify = Date.now();
    }

    public guildNotify(message: string): void {
        this.send(new GuildPacket(Opcodes.Guild.Error, { message }));
    }

    public pointer(info: PointerData, remove = true): void {
        if (remove) this.send(new PointerPacket(Opcodes.Pointer.Remove));

        if (!(info.type in Opcodes.Pointer)) return;

        this.send(new PointerPacket(info.type, info));
    }

    public save(): void {
        if (config.skipDatabase || this.isGuest || !this.ready) return;

        this.database.creator?.save(this);
    }

    public override serialize(
        withEquipment = false,
        withExperience = false,
        withMana = false
    ): PlayerData {
        let data = super.serialize() as PlayerData & { cash?: number; customTag?: string; xpBoostUntil?: number; isPriority?: boolean };

        data.name = Utils.formatName(this.username || this.name);
        if (this.isAdmin() && !data.name.startsWith('[ADM]')) {
            data.name = `[ADM] ${data.name}`;
        }
        data.rank = this.rank;
        data.level = this.skills.getCombatLevel();
        data.hitPoints = this.hitPoints.getHitPoints();
        data.maxHitPoints = this.hitPoints.getMaxHitPoints();
        data.attackRange = this.attackRange;
        data.movementSpeed = this.getMovementSpeed();

        data.cash = this.cash;
        data.customTag = this.customTag;
        data.xpBoostUntil = this.xpBoostUntil;
        data.isPriority = this.isPriority;

        if (this.inTeamWar() || this.isAdmin()) data.displayInfo = this.getDisplayInfo();

        if (withEquipment) data.equipments = this.equipment.serialize(true).equipments;

        if (withExperience) data.experience = this.getTotalExperience();

        if (withMana) {
            data.mana = this.mana.getMana();
            data.maxMana = this.mana.getMaxMana();
        }

        return data;
    }

    public override getAttackStats(): Stats {
        return this.equipment.totalAttackStats;
    }

    public override getDefenseStats(): Stats {
        return this.equipment.totalDefenseStats;
    }

    public override getBonuses(): Bonuses {
        return this.equipment.totalBonuses;
    }

    public override getAccuracyBonus(): number {
        if (this.isArcher()) return this.getBonuses().archery;
        if (this.isMagic()) return this.getBonuses().magic;

        return this.getBonuses().accuracy;
    }

    public override getAccuracyLevel(): number {
        if (this.isMagic()) return this.skills.get(Modules.Skills.Magic).level;
        if (this.isArcher()) return this.skills.get(Modules.Skills.Archery).level;

        return this.skills.get(Modules.Skills.Accuracy).level;
    }

    public override getStrengthLevel(): number {
        return this.skills.get(Modules.Skills.Strength).level;
    }

    public override getArcheryLevel(): number {
        return this.skills.get(Modules.Skills.Archery).level;
    }

    public override getDefenseLevel(): number {
        return this.skills.get(Modules.Skills.Defense).level;
    }

    private getMagicLevel(): number {
        return this.skills.get(Modules.Skills.Magic).level;
    }

    public getLastAttackStyle(weaponType: string): Modules.AttackStyle {
        return this.lastStyles[weaponType];
    }

    public override getDamageBonus(): number {
        if (this.isMagic()) {
            if (!this.hasManaForAttack()) return -3;
            return this.getBonuses().magic;
        }

        if (this.isArcher()) return this.getBonuses().archery;

        return this.getBonuses().strength;
    }

    public override getSkillDamageLevel(): number {
        if (this.isMagic()) return this.getMagicLevel();
        if (this.isArcher()) return this.getArcheryLevel();

        return this.getStrengthLevel();
    }

    public override getDamageReduction(): number {
        let reduction = 1;

        if (this.status.has(Modules.Effects.ThickSkin)) reduction -= 0.2;
        if (this.getAttackStyle() === Modules.AttackStyle.Defensive) reduction -= 0.1;
        if (this.getAttackStyle() === Modules.AttackStyle.Shared) reduction -= 0.04;

        return reduction;
    }

    public override getAttackStyle(): Modules.AttackStyle {
        return this.equipment.getWeapon().attackStyle;
    }

    public override getDamageType(): Modules.Hits {
        if (this.isArcher()) {
            let arrows = this.equipment.getArrows();

            if (arrows.freezing && Formulas.getEffectChance()) return Modules.Hits.Freezing;
            if (arrows.burning && Formulas.getEffectChance()) return Modules.Hits.Burning;

            let weapon = this.equipment.getWeapon();

            if (weapon.isStun() && Formulas.getEffectChance()) return Modules.Hits.Stun;

            if (weapon.isExplosive() && Formulas.getEffectChance()) {
                this.aoe = 1;
                return Modules.Hits.Explosive;
            }
        } else {
            let weapon = this.equipment.getWeapon();

            if (weapon.isCritical() && Formulas.getEffectChance()) return Modules.Hits.Critical;
        }

        return Modules.Hits.Normal;
    }

    public override getProjectileName(): string {
        if (!this.quests.isTutorialFinished()) return this.projectileName;

        if (this.isArcher()) return this.equipment.getArrows().projectileName;

        return this.equipment.getWeapon().projectileName;
    }

    public override getBloodsuckingLevel(): number {
        return (
            this.equipment.getWeapon().enchantments[Modules.Enchantment.Bloodsucking]?.level || 1
        );
    }

    public override getAttackRate(): number {
        if (this.status.has(Modules.Effects.DualistsMark))
            return this.equipment.getWeapon().attackRate - 200;

        return this.equipment.getWeapon().attackRate;
    }

    public getJailDuration(): string {
        let duration = this.jail - Date.now();

        return duration > 60_000
            ? `${Math.ceil(duration / 60_000)} more minutes`
            : `${Math.floor(duration / 1000)} more seconds`;
    }

    public onKill(callback: KillCallback): void {
        this.killCallback = callback;
    }

    public onTalkToNPC(callback: NPCTalkCallback): void {
        this.npcTalkCallback = callback;
    }

    public onDoor(callback: DoorCallback): void {
        this.doorCallback = callback;
    }

    public onCheatScore(callback: () => void): void {
        this.cheatScoreCallback = callback;
    }

    public onRegion(callback: RegionCallback): void {
        this.regionCallback = callback;
    }

    public onRecentRegions(callback: RecentRegionsCallback): void {
        this.recentRegionsCallback = callback;
    }
}
