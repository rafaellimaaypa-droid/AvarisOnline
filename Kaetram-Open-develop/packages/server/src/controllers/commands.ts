import Formulas from '../info/formulas';
import Item from '../game/entity/objects/item';
import Character from '../game/entity/character/character';
import Items from '../../data/items.json';

import log from '@kaetram/common/util/log';
import Utils from '@kaetram/common/util/utils';
import Filter from '@kaetram/common/util/filter';
import { Modules, Opcodes } from '@kaetram/common/network';
import {
    CommandPacket,
    DespawnPacket,
    NPCPacket,
    SpawnPacket,
    StorePacket
} from '@kaetram/common/network/impl';

import type Region from '../game/map/region';
import type Entity from '../game/entity/entity';
import type Mob from '../game/entity/character/mob/mob';
import type Player from '../game/entity/character/player/player';
import type Quest from '../game/entity/character/player/quest/quest';
import type Skill from '../game/entity/character/player/skill/skill';
import type Achievement from '../game/entity/character/player/achievement/achievement';

export default class Commands {
    private world;
    private entities;

    public constructor(private player: Player) {
        let { world } = player;

        this.world = world;
        this.entities = world.entities;
    }

    public parse(rawText: string): void {
        let blocks = rawText.slice(1).split(' ');

        if (blocks.length === 0) return;

        let command = blocks.shift()!;

        this.handlePlayerCommands(command, blocks);
        this.handleModeratorCommands(command, blocks);
        this.handleAdminCommands(command, blocks);
    }

    /**
     * Commands that are accessible to all the players.
     * @param command The command that was entered.
     * @param blocks Associated string blocks after the command.
     */

    private async handlePlayerCommands(command: string, blocks: string[]): Promise<void> {
        switch (command) {
            case 'players': {
                let players = this.world.entities.getPlayerUsernames(),
                    population = players.length,
                    singular = population === 1;

                this.player.notify(
                    `There ${singular ? 'is' : 'are'} currently ${population} ${
                        singular ? 'person' : 'people'
                    } online.`
                );

                if (this.player.isAdmin()) this.player.notify(players.join(', '));

                return;
            }

            case 'coords': {
                return this.player.notify(`x: ${this.player.x} y: ${this.player.y}`);
            }

            case 'cash':
            case 'saldo': {
                return this.player.notify(`Seu saldo de Cash é: ${this.player.cash || 0} Cash.`, 'aquamarine');
            }

            case 'buy':
            case 'loja': {
                let option = blocks.shift()?.toLowerCase();

                if (!option) {
                    this.player.notify('=== LOJA PREMIUM AVARIS ONLINE ===', 'gold');
                    this.player.notify('Seu saldo: ' + (this.player.cash || 0) + ' Cash', 'aquamarine');
                    this.player.notify('/buy namechange <novoNome> (500 Cash) - Alterar nome de usuário');
                    this.player.notify('/buy mysterybox (100 Cash) - Abrir caixa com recompensas aleatórias');
                    this.player.notify('/buy tag <nomeDaTag> (200 Cash) - Equipar tag customizada no chat');
                    this.player.notify('/buy xpboost <horas> (150 Cash/hora) - Ativar bônus de 2x XP');
                    this.player.notify('/buy priority (1000 Cash) - Fila de entrada prioritária permanente');
                    return;
                }

                switch (option) {
                    case 'namechange': {
                        let newName = blocks.shift();
                        if (!newName)
                            return this.player.notify('Uso: /buy namechange <novoNome>');

                        if (this.player.cash < 500)
                            return this.player.notify('Cash insuficiente. Preço: 500 Cash.', 'crimson');

                        let cleanName = newName.trim();
                        if (cleanName.length < 3 || cleanName.length > 16 || !/^[a-zA-Z0-9_]+$/.test(cleanName))
                            return this.player.notify('Nome inválido. Deve ter entre 3 e 16 caracteres alfanuméricos.');

                        let existing = this.world.getPlayerByName(cleanName.toLowerCase());
                        if (existing)
                            return this.player.notify('Este nome já está em uso por outro jogador.');

                        this.player.cash -= 500;
                        let oldName = this.player.username;
                        this.player.username = cleanName;
                        this.player.name = cleanName;
                        this.player.save();
                        this.player.sync();

                        this.player.notify(`Seu nome foi alterado de ${oldName} para ${cleanName}!`, 'gold');
                        break;
                    }

                    case 'mysterybox':
                    case 'caixa': {
                        if (this.player.cash < 100)
                            return this.player.notify('Cash insuficiente. Preço: 100 Cash.', 'crimson');

                        if (!this.player.inventory.hasSpace())
                            return this.player.notify('Seu inventário está cheio!', 'crimson');

                        this.player.cash -= 100;

                        let rewards = [
                            { key: 'gold', count: 10000, name: '10.000 Ouro' },
                            { key: 'gold', count: 25000, name: '25.000 Ouro' },
                            { key: 'oldonesblade', count: 1, name: 'Lâmina dos Antigos' },
                            { key: 'dragonscale', count: 1, name: 'Escama de Dragão' },
                            { key: 'ruby', count: 5, name: '5x Rubis' },
                            { key: 'emerald', count: 5, name: '5x Esmeraldas' },
                            { key: 'hotsauce', count: 3, name: '3x Molho Pimentão' },
                            { key: 'firepotion', count: 2, name: '2x Poções de Fogo' }
                        ];

                        let reward = rewards[Math.floor(Math.random() * rewards.length)];
                        this.player.inventory.add(new Item(reward.key, -1, -1, true, reward.count));
                        this.player.save();
                        this.player.sync();

                        this.player.popup('Caixa Misteriosa!', `Você abriu uma Caixa Misteriosa e ganhou: ${reward.name}!`, '#FFD700', 'heal');
                        this.player.notify(`Caixa Misteriosa aberta! Recompensa: ${reward.name}.`, 'gold');
                        break;
                    }

                    case 'tag': {
                        let tag = blocks.shift();
                        if (!tag)
                            return this.player.notify('Uso: /buy tag <nomeDaTag> (ou /buy tag limpar para remover)');

                        if (tag.toLowerCase() === 'limpar' || tag.toLowerCase() === 'none') {
                            this.player.customTag = '';
                            this.player.save();
                            return this.player.notify('Sua tag customizada foi removida.');
                        }

                        if (this.player.cash < 200)
                            return this.player.notify('Cash insuficiente. Preço: 200 Cash.', 'crimson');

                        let cleanTag = tag.trim().toUpperCase().slice(0, 10);
                        this.player.cash -= 200;
                        this.player.customTag = cleanTag;
                        this.player.save();
                        this.player.sync();

                        this.player.notify(`Sua tag foi alterada para [${cleanTag}]!`, 'gold');
                        break;
                    }

                    case 'xpboost': {
                        let hours = parseInt(blocks.shift()!) || 1;
                        if (hours < 1) hours = 1;
                        if (hours > 24) hours = 24;

                        let cost = hours * 150;
                        if (this.player.cash < cost)
                            return this.player.notify(`Cash insuficiente. Custo: ${cost} Cash para ${hours}h.`, 'crimson');

                        this.player.cash -= cost;
                        let now = Date.now();
                        if (this.player.xpBoostUntil < now) {
                            this.player.xpBoostUntil = now + hours * 3600 * 1000;
                        } else {
                            this.player.xpBoostUntil += hours * 3600 * 1000;
                        }

                        this.player.save();
                        this.player.sync();

                        let remainingHours = Math.ceil((this.player.xpBoostUntil - now) / (3600 * 1000));
                        this.player.notify(`Bônus de 2x XP ativado! Tempo total restante: ${remainingHours} hora(s).`, 'gold');
                        break;
                    }

                    case 'priority':
                    case 'vip': {
                        if (this.player.isPriority)
                            return this.player.notify('Você já possui acesso prioritário permanente.');

                        if (this.player.cash < 1000)
                            return this.player.notify('Cash insuficiente. Preço: 1000 Cash.', 'crimson');

                        this.player.cash -= 1000;
                        this.player.isPriority = true;
                        this.player.save();
                        this.player.sync();

                        this.player.notify('Sua conta agora possui Fila de Entrada Prioritária Permanente!', 'gold');
                        break;
                    }

                    default: {
                        this.player.notify('Opção da loja inválida. Use /buy para ver as opções.');
                        break;
                    }
                }
                return;
            }

            case 'g':
            case 'gc':
            case 'global': {
                return this.player.chat(
                    Filter.clean(blocks.join(' ')),
                    true,
                    false,
                    'rgba(191, 161, 63, 1.0)'
                );
            }

            case 'pm':
            case 'msg': {
                let asterikBlocks = blocks.join(' ').split('*'),
                    [, username] = asterikBlocks;

                if (!username) return;

                let message = blocks.slice(username.split(' ').length).join(' ');

                this.player.sendPrivateMessage(username.toLowerCase(), message);

                break;
            }

            case 'ping': {
                this.player.ping();
                break;
            }

            case 'guild': {
                let subCommand = blocks.shift()!;

                if (!this.player.guild) return this.player.notify('You are not in a guild.');

                switch (subCommand) {
                    case 'kick': {
                        let username = blocks.join(' ');

                        if (!username)
                            return this.player.notify(
                                'Malformed command, expected /guild kick [username]'
                            );

                        this.world.guilds.kick(this.player, username);

                        this.player.notify(`You have kicked ${username} from your guild.`);

                        break;
                    }

                    case 'rank': {
                        let rank = blocks.shift()!,
                            username = blocks.join(' ');

                        if (!rank || !username)
                            return this.player.notify(
                                'Malformed command, expected /guild rank [rank 0-6] [username]'
                            );

                        if (parseInt(rank) === 7 || rank === 'landlord')
                            return this.player.notify('You cannot set a rank to landlord.');

                        let guild = await this.world.guilds.getGuild(this.player.guild);

                        if (!guild) return this.player.notify('You are not in a guild.');

                        let member = await this.world.guilds.getMember(guild, username);

                        if (!member)
                            return this.player.notify(
                                `Could not find a member with the name: ${username}.`
                            );

                        this.world.guilds.setRank(guild, this.player, member, parseInt(rank));

                        this.player.notify(`You have set ${username}'s rank to ${rank}.`);

                        break;
                    }
                }

                break;
            }
        }
    }

    /**
     * Commands only accessible to moderators and administrators.
     * @param command The command that was entered.
     * @param blocks The associated string blocks after the command.
     */

    private handleModeratorCommands(command: string, blocks: string[]): void {
        if (!this.player.isMod() && !this.player.isAdmin() && !this.player.isHollowAdmin()) return;

        switch (command) {
            case 'mute':
            case 'ban': {
                let duration = parseInt(blocks.shift()!),
                    targetName = blocks.join(' ').toLowerCase();

                if (!duration || !targetName)
                    return this.player.notify(
                        'Malformed command, expected /ban(mute) [duration] [username]'
                    );

                if (targetName === this.player.username)
                    return this.player.notify(`You cannot ban yourself you silly. Thanks James.`);

                let user: Player = this.world.getPlayerByName(targetName);

                if (!user)
                    return this.player.notify(`Could not find player with name: ${targetName}.`);

                if (this.player.isMod()) {
                    if (command === 'mute' && duration > 168) duration = 168;
                    if (command === 'ban' && duration > 72) duration = 72;
                }

                let hours = duration;

                duration *= 60 * 60 * 1000;

                let timeFrame = Date.now() + duration;

                if (command === 'mute') {
                    user.mute = timeFrame;
                    user.save();

                    this.player.notify(`${user.username} has been muted for ${hours} hours.`);
                } else if (command === 'ban') {
                    user.ban = timeFrame;

                    user.connection.sendUTF8('ban');
                    user.connection.close('banned');

                    this.player.notify(`${user.username} has been banned for ${hours} hours.`);
                }

                return;
            }

            case 'unmute': {
                let uTargetName = blocks.join(' '),
                    uUser = this.world.getPlayerByName(uTargetName);

                if (!uTargetName) return this.player.notify(`Player ${uTargetName} not found.`);

                uUser.mute = Date.now() - 3600;

                uUser.save();

                this.player.notify(`${uUser.username} has been unmuted.`);

                return;
            }

            case 'kick':
            case 'forcekick': {
                let username = blocks.join(' ');

                if (!username)
                    return this.player.notify(`Malformed command, expected /kick username`);

                let player = this.world.getPlayerByName(username);

                if (!player)
                    return this.player.notify(`Could not find player with name: ${username}`);

                player.connection.close(
                    `${this.player.username} kicked ${username}`,
                    command === 'forcekick'
                );

                break;
            }

            case 'jail': {
                let duration = parseInt(blocks.shift()!),
                    username = blocks.join(' ');

                if (!duration || !username)
                    return this.player.notify(
                        'Malformed command, expected /jail [duration] [username]'
                    );

                let player = this.world.getPlayerByName(username);

                if (!player)
                    return this.player.notify(`Could not find player with name: ${username}`);

                if (this.player.isMod() && duration > 12) duration = 12;

                let hours = duration;

                duration *= 60 * 60 * 1000;

                player.jail = Date.now() + duration;
                player.sendToSpawn();

                player.notify(`You have been jailed for ${hours} hours.`, 'crimsonred');
                this.player.notify(`${player.username} has been jailed for ${hours} hours.`);

                break;
            }

            case 'unjail': {
                let username = blocks.join(' ');

                if (!username)
                    return this.player.notify(`Malformed command, expected /unjail [username]`);

                let player = this.world.getPlayerByName(username);

                if (!player)
                    return this.player.notify(`Could not find player with name: ${username}`);

                player.jail = 0;
                player.sendToSpawn();

                player.notify(`You have been unjailed.`);
                this.player.notify(`${player.username} has been unjailed.`);
            }
        }
    }

    /**
     * The commands only accessible to administrators.
     * @param command The command that was entered.
     * @param blocks The associated string blocks after the command.
     */

    private handleAdminCommands(command: string, blocks: string[]): void {
        if (!this.player.isAdmin()) return;

        let username: string,
            player: Player,
            x: number,
            y: number,
            instance: string,
            target: string,
            key: string,
            entity: Character,
            targetEntity: Character,
            questKey: string,
            quest: Quest,
            achievementKey: string,
            achievement: Achievement,
            region: Region,
            item: Item;

        switch (command) {
            case 'addcash': {
                let arg1 = blocks.shift()!,
                    arg2 = blocks.shift()!;

                let amount = parseInt(arg1),
                    targetName = arg2;

                if (isNaN(amount)) {
                    amount = parseInt(arg2);
                    targetName = arg1;
                }

                if (!targetName || isNaN(amount))
                    return this.player.notify(
                        'Formato incorreto. Uso: /addcash [username] [quantidade]'
                    );

                let targetPlayer = this.world.getPlayerByName(targetName.toLowerCase());

                if (!targetPlayer)
                    return this.player.notify(`Jogador ${targetName} não foi encontrado.`);

                targetPlayer.cash = (targetPlayer.cash || 0) + amount;
                targetPlayer.save();
                targetPlayer.sync();

                targetPlayer.notify(`Sua conta recebeu ${amount} de Cash! Saldo atual: ${targetPlayer.cash}`, 'gold');
                this.player.notify(`Adicionado ${amount} de Cash para ${targetPlayer.username}. Saldo atual do alvo: ${targetPlayer.cash}`, 'gold');

                return;
            }

            case 'gold':
            case 'givegold': {
                let amount = parseInt(blocks.shift()!),
                    targetName = blocks.join(' ');

                if (!amount || isNaN(amount))
                    return this.player.notify(
                        'Formato incorreto. Uso: /givegold [quantidade] [username?]'
                    );

                let targetPlayer = targetName
                    ? this.world.getPlayerByName(targetName)
                    : this.player;

                if (!targetPlayer)
                    return this.player.notify(`Jogador ${targetName} não foi encontrado.`);

                targetPlayer.inventory.add(new Item('gold', -1, -1, true, amount));

                targetPlayer.notify(`Você recebeu ${amount} de ouro.`);
                if (targetPlayer !== this.player)
                    this.player.notify(`Deu ${amount} de ouro para ${targetPlayer.username}.`);

                return;
            }

            case 'takegold': {
                let amount = parseInt(blocks.shift()!),
                    targetName = blocks.join(' ');

                if (!amount || isNaN(amount) || !targetName)
                    return this.player.notify(
                        'Formato incorreto. Uso: /takegold [quantidade] [username]'
                    );

                let targetPlayer = this.world.getPlayerByName(targetName);

                if (!targetPlayer)
                    return this.player.notify(`Jogador ${targetName} não foi encontrado.`);

                targetPlayer.inventory.removeItem('gold', amount);

                targetPlayer.notify(`Foram removidos ${amount} de ouro do seu inventário.`);
                this.player.notify(`Removidos ${amount} de ouro de ${targetPlayer.username}.`);

                return;
            }

            case 'giveitem': {
                let itemKey = blocks.shift()!,
                    count = parseInt(blocks.shift()!),
                    targetName = blocks.join(' ');

                if (!itemKey || !count || isNaN(count) || !targetName)
                    return this.player.notify(
                        'Formato incorreto. Uso: /giveitem [itemKey] [quantidade] [username]'
                    );

                let targetPlayer = this.world.getPlayerByName(targetName);

                if (!targetPlayer)
                    return this.player.notify(`Jogador ${targetName} não foi encontrado.`);

                item = new Item(itemKey, -1, -1, true, count);

                if (!item.exists)
                    return this.player.notify(`Item com a chave '${itemKey}' não existe.`);

                targetPlayer.inventory.add(item);

                targetPlayer.notify(`Você recebeu ${count}x ${itemKey} de um administrador.`);
                this.player.notify(
                    `Entregue ${count}x ${itemKey} para ${targetPlayer.username}.`
                );

                return;
            }

            case 'clearinventory': {
                let targetName = blocks.join(' ');
                let targetPlayer = targetName
                    ? this.world.getPlayerByName(targetName)
                    : this.player;

                if (!targetPlayer)
                    return this.player.notify(`Jogador ${targetName} não foi encontrado.`);

                targetPlayer.inventory.empty();

                targetPlayer.notify('Seu inventário foi limpo por um administrador.');
                if (targetPlayer !== this.player)
                    this.player.notify(`Inventário de ${targetPlayer.username} foi limpo.`);

                return;
            }

            case 'spawn': {
                let key = blocks.shift(),
                    count = parseInt(blocks.shift()!);

                if (!key) return;

                if (!count) count = 1;

                item = new Item(key, -1, -1, true, 1);

                if (!item.exists) return this.player.notify(`No item with key ${key} exists.`);

                item.count = count;

                this.player.inventory.add(item);

                return;
            }

            case 'take': {
                let index = parseInt(blocks.shift()!),
                    container = blocks.shift()!,
                    username = blocks.join(' ');

                if (!index || !username)
                    return this.player.notify(
                        'Invalid command, usage /take [index] [container=bank/inventory] [username]'
                    );

                let player = this.world.getPlayerByName(username);

                if (!player) return this.player.notify(`Player ${username} not found.`);

                let containerType = container === 'inventory' ? player.inventory : player.bank,
                    slot = containerType.get(index);

                if (!slot.key)
                    return this.player.notify(`Player ${username} has no item at index ${index}.`);

                containerType.remove(index, slot.count);

                this.player.notify(`Took ${slot.count}x ${slot.key} from ${username}.`);

                return;
            }

            case 'takeitem': {
                let key = blocks.shift(),
                    count = parseInt(blocks.shift()!),
                    container = blocks.shift()!,
                    username = blocks.join(' ');

                if (!key || !username || (container !== 'inventory' && container !== 'bank'))
                    return this.player.notify(
                        'Invalid command, usage /takeitem [key] [count] [container=bank/inventory] [username]'
                    );

                let player = this.world.getPlayerByName(username);

                if (!player) return this.player.notify(`Player ${username} not found.`);

                let containerType = container === 'inventory' ? player.inventory : player.bank;

                containerType.removeItem(key, count);

                this.player.notify(`Took ${count}x ${key} from ${username}.`);

                return;
            }

            case 'copybank':
            case 'copyinventory': {
                let username = blocks.join(' ');

                if (!username)
                    return this.player.notify('Invalid command, usage /copybank [username]');

                let player = this.world.getPlayerByName(username);

                if (!player) return this.player.notify(`Player ${username} is not online.`);

                if (command === 'copybank') {
                    this.player.bank.empty();

                    player.bank.forEachSlot((slot) =>
                        this.player.bank.add(this.player.bank.getItem(slot))
                    );
                } else {
                    this.player.inventory.empty();

                    player.inventory.forEachSlot((slot) =>
                        this.player.inventory.add(this.player.inventory.getItem(slot))
                    );
                }

                this.player.notify(`Copied ${username}'s ${command} to your ${command}.`);

                break;
            }

            case 'drop': {
                let key = blocks.shift(),
                    count = parseInt(blocks.shift()!);

                if (!key) return;

                if (!count) count = 1;

                this.world.entities.spawnItem(key, this.player.x, this.player.y, true, count);

                break;
            }

            case 'remove': {
                let key = blocks.shift(),
                    count = parseInt(blocks.shift()!);

                if (!key || !count) return;

                this.player.inventory.removeItem(key, count);

                return;
            }

            case 'empty': {
                return this.player.inventory.empty();
            }

            case 'teleport': {
                let x = parseInt(blocks.shift()!),
                    y = parseInt(blocks.shift()!),
                    withAnimation = parseInt(blocks.shift()!);

                if (x && y) this.player.teleport(x, y, !!withAnimation, false, true);

                return;
            }

            case 'teletome': {
                username = blocks.join(' ');
                player = this.world.getPlayerByName(username);

                player?.teleport(this.player.x, this.player.y, false, false, true);

                return;
            }

            case 'teleto': {
                username = blocks.join(' ');
                player = this.world.getPlayerByName(username);

                if (player) this.player.teleport(player.x, player.y, false, false, true);

                return;
            }

            case 'immortal':
            case 'nohit':
            case 'invincible': {
                if (this.player.status.has(Modules.Effects.Invincible)) {
                    this.player.status.remove(Modules.Effects.Invincible);

                    this.player.notify('You are no longer invincible.');
                } else {
                    this.player.status.add(Modules.Effects.Invincible);

                    this.player.notify('You are now invincible.');
                }
                return;
            }

            case 'mob': {
                target = blocks.shift()!;

                if (!target) return this.player.notify('No mob specified.');

                this.entities.spawnMob(target, this.player.x, this.player.y);

                return;
            }

            case 'allattack': {
                region = this.world.map.regions.get(this.player.region);
                target = blocks.shift()!;

                if (!target)
                    return this.player.notify(
                        `Invalid command. Usage: /allattack [target_instance]`
                    );

                if (!region) return this.player.notify('Bro what.');

                targetEntity = this.entities.get(target) as Character;

                if (!targetEntity) return;

                region.forEachEntity((entity: Entity) => {
                    if (!entity.isMob() || entity.instance === target) return;

                    entity.combat.attack(targetEntity);
                });

                break;
            }

            case 'pointer': {
                if (blocks.length > 1) {
                    let posX = parseInt(blocks.shift()!),
                        posY = parseInt(blocks.shift()!);

                    if (!posX || !posY) return;

                    this.player.pointer({
                        type: Opcodes.Pointer.Location,
                        instance: this.player.instance,
                        x: posX,
                        y: posY
                    });
                } else {
                    let instance = blocks.shift()!;

                    if (!instance) return;

                    this.player.pointer(
                        {
                            type: Opcodes.Pointer.Entity,
                            instance
                        },
                        false
                    );
                }

                return;
            }

            case 'teleall': {
                this.entities.forEachPlayer((player: Player) => {
                    player.teleport(this.player.x, this.player.y, false, false, true);
                });

                return;
            }

            case 'getregion': {
                this.player.notify(`Current Region: ${this.player.region}`);
                return;
            }

            case 'debug': {
                this.player.send(new CommandPacket({ command: 'debug' }));

                return;
            }

            case 'addexp':
            case 'addexperience': {
                key = blocks.shift()!;
                x = parseInt(blocks.shift()!);

                if (!key || !x) return;

                key = key.charAt(0).toUpperCase() + key.slice(1);

                this.player.skills
                    .get(Modules.Skills[key as keyof typeof Modules.Skills])
                    ?.addExperience(x);

                return;
            }

            case 'setlevel': {
                key = blocks.shift()!;
                x = parseInt(blocks.shift()!);
                username = blocks.join(' ');

                if (!username || !key || !x)
                    return this.player.notify(
                        'Malformed command, expected /setlevel [skill] [level] [username]'
                    );

                player = this.world.getPlayerByName(username);

                if (!player) return this.player.notify(`Player ${username} is not online.`);

                key = key.charAt(0).toUpperCase() + key.slice(1);

                let skill = player.skills.get(Modules.Skills[key as keyof typeof Modules.Skills]);

                if (!skill) return this.player.notify('Invalid skill.');

                if (x < skill.level) {
                    skill.setExperience(0);
                    skill.addExperience(0);
                } else skill.addExperience(Formulas.levelsToExperience(skill.level, x));

                return;
            }

            case 'resetskills': {
                this.player.skills.forEachSkill((skill: Skill) => {
                    skill.setExperience(0);
                    skill.addExperience(0);
                });
                this.player.skills.sync();
                break;
            }

            case 'max': {
                this.player.skills.forEachSkill((skill: Skill) => {
                    skill.setExperience(0);
                    skill.addExperience(696_420_969);
                });
                break;
            }

            case 'attackrange': {
                log.info(this.player.attackRange);
                return;
            }

            case 'resetregions': {
                log.info('Resetting regions...');

                this.player.regionsLoaded = [];
                this.player.updateRegion();

                return;
            }

            case 'clear': {
                this.player.inventory.forEachSlot((slot) => {
                    this.player.inventory.remove(slot.index, slot.count);
                });

                break;
            }

            case 'timeout': {
                this.player.connection.reject('timeout');

                break;
            }

            case 'togglepvp': {
                this.entities.forEachPlayer((player: Player) => {
                    player.updatePVP(true);
                });

                break;
            }

            case 'ms': {
                let movementSpeed = parseInt(blocks.shift()!);

                if (!movementSpeed) {
                    this.player.notify('No movement speed specified.');
                    return;
                }

                if (isNaN(movementSpeed)) {
                    this.player.notify('Invalid movement speed specified.');
                    return;
                }

                if (movementSpeed > 10_000) movementSpeed = 2000;

                if (movementSpeed < 75)
                    movementSpeed = 75;

                this.player.overrideMovementSpeed = movementSpeed;

                break;
            }

            case 'popup': {
                this.player.popup(
                    'New Quest Found!',
                    '@blue@New @darkblue@quest @green@has@red@ been discovered!'
                );

                break;
            }

            case 'undostage': {
                key = blocks.shift()!;

                if (!key) return this.player.notify('No quest specified.');

                let quest = this.player.quests.get(key);

                if (!quest) return this.player.notify('Could not find quest.');

                quest.setStage(quest.getStage() - 1);

                break;
            }

            case 'resetquests': {
                this.player.quests.forEachQuest((quest: Quest) => {
                    quest.setStage(0, undefined, true, true);
                });
                break;
            }

            case 'resetquest': {
                key = blocks.shift()!;

                if (!key) return this.player.notify('No quest specified.');

                let quest = this.player.quests.get(key);

                quest.setStage(0, undefined, true, true);
                break;
            }

            case 'resetachievements': {
                this.player.achievements.forEachAchievement((achievement) =>
                    achievement.setStage(0)
                );

                this.player.updateRegion();

                break;
            }

            case 'movenpc': {
                instance = blocks.shift()!;
                x = parseInt(blocks.shift()!);
                y = parseInt(blocks.shift()!);

                if (!instance)
                    return this.player.notify(`Malformed command, expected /movenpc instance x y`);

                entity = this.entities.get(instance) as Character;

                if (!entity) return this.player.notify(`Entity not found.`);

                if (entity.isMob()) entity.setPosition(x, y);

                break;
            }

            case 'nvn': {
                instance = blocks.shift()!;
                target = blocks.shift()!;

                if (!instance || !target)
                    return this.player.notify(`Malformed command, expected /nvn instance target`);

                entity = this.entities.get(instance) as Character;
                targetEntity = this.entities.get(target) as Character;

                if (!entity || !targetEntity)
                    return this.player.notify(`Could not find entity instances specified.`);

                entity.combat.attack(targetEntity);

                this.player.notify(`${entity.name} is attacking ${targetEntity.name}`);

                break;
            }

            case 'kill': {
                username = blocks.join(' ');

                if (!username)
                    return this.player.notify(
                        `Malformed command, expected /kill username/instance`
                    );

                player = this.world.getPlayerByName(username);

                if (player) player.hit(player.hitPoints.getHitPoints());

                targetEntity = this.entities.get(username) as Character;

                if (targetEntity) targetEntity.hit(targetEntity.hitPoints.getHitPoints());

                break;
            }

            case 'finishquest': {
                questKey = blocks.shift()!;

                if (!questKey)
                    return this.player.notify(`Malformed command, expected /finishquest questKey`);

                quest = this.player.quests.get(questKey);

                if (quest) quest.setStage(9999);
                else this.player.notify(`Could not find quest with key: ${questKey}`);

                break;
            }

            case 'finishachievement': {
                achievementKey = blocks.shift()!;

                if (!achievementKey)
                    return this.player.notify(
                        `Malformed command, expected /finishachievement achievementKey`
                    );

                achievement = this.player.achievements.get(achievementKey);

                if (achievement) achievement.finish();
                else this.player.notify(`Could not find achievement with key: ${achievementKey}`);

                break;
            }

            case 'finishachievements': {
                return this.player.achievements.forEachAchievement((achievement) =>
                    achievement.finish()
                );
            }

            case 'poison': {
                instance = blocks.shift()!;

                if (instance) {
                    log.debug('Poisoning entity...');

                    entity = this.entities.get(instance) as Character;

                    if (!entity)
                        return this.player.notify(
                            `Could not find entity with instance: ${instance}`
                        );

                    if (!entity.isMob() && !entity.isPlayer())
                        this.player.notify('That entity cannot be poisoned.');

                    if (entity.poison) {
                        entity.setPoison();
                        this.player.notify('Entity has been cured of poison.');
                    } else {
                        entity.setPoison(0);
                        this.player.notify('Entity has been poisoned.');
                    }
                } else {
                    log.debug('Poisoning player.');

                    if (this.player.poison) {
                        this.player.setPoison();
                        this.player.notify('Your poison has been cured!');
                    } else {
                        this.player.setPoison(0);
                        this.player.notify('You have been poisoned!');
                    }
                }

                break;
            }

            case 'poisonarea': {
                region = this.world.map.regions.get(this.player.region);

                if (!region) this.player.notify('Bro something went badly wrong wtf.');

                this.player.notify(`All entities in the region will be nuked with poison.`);

                region.forEachEntity((entity: Entity) => {
                    if (!entity.isMob() && !entity.isPlayer()) return;

                    (entity as Character).setPoison(0);
                });

                break;
            }

            case 'roam': {
                region = this.world.map.regions.get(this.player.region);

                if (!region) this.player.notify('Bro something went badly wrong wtf.');

                this.player.notify(`All mobs in the region will now roam!`);

                region.forEachEntity((entity: Entity) => {
                    if (!entity.isMob()) return;

                    entity.roamingCallback?.();
                });

                break;
            }

            case 'talk': {
                instance = blocks.shift()!;

                if (!instance)
                    return this.player.notify(`Malformed command, expected /talk instance`);

                targetEntity = this.entities.get(instance) as Character;

                if (!targetEntity)
                    return this.player.notify(`Could not find entity with instance: ${instance}`);

                (targetEntity as Mob).talkCallback?.('This is a test talking message lol');

                break;
            }

            case 'distance': {
                x = parseInt(blocks.shift()!);
                y = parseInt(blocks.shift()!);

                if (!x || !y)
                    return this.player.notify(`Malformed command, expected /distance x y`);

                this.player.notify(
                    `Distance: ${Utils.getDistance(this.player.x, this.player.y, x, y)}`
                );

                break;
            }

            case 'nuke': {
                let all = !!blocks.shift();

                region = this.world.map.regions.get(this.player.region);

                region.forEachEntity((entity: Entity) => {
                    if (!(entity instanceof Character)) return;
                    if (entity.instance === this.player.instance) return;

                    if (!all && entity.isPlayer()) return;

                    entity.deathCallback?.(this.player);
                });

                this.player.notify(
                    'Congratulations, you killed everyone, are you happy with yourself?'
                );

                break;
            }

            case 'noclip': {
                this.player.noclip = !this.player.noclip;

                this.player.notify(`Noclip: ${this.player.noclip}`);
                break;
            }

            case 'addability': {
                key = blocks.shift()!;

                if (!key) return this.player.notify(`Malformed command, expected /addability key`);

                this.player.abilities.add(key, 1);
                break;
            }

            case 'setability': {
                key = blocks.shift()!;
                x = parseInt(blocks.shift()!);

                if (!key || !x)
                    return this.player.notify(`Malformed command, expected /setability key level`);

                this.player.abilities.setLevel(key, x);

                break;
            }

            case 'setquickslot': {
                key = blocks.shift()!;
                x = parseInt(blocks.shift()!);

                if (!key || isNaN(x))
                    return this.player.notify(
                        `Malformed command, expected /setquickslot key quickslot`
                    );

                this.player.abilities.setQuickSlot(key, x);
                break;
            }

            case 'resetabilities': {
                return this.player.abilities.reset();
            }

            case 'store': {
                key = blocks.shift()!;

                if (!key) return this.player.notify(`Malformed command, expected /store key`);

                this.player.send(
                    new StorePacket(Opcodes.Store.Open, this.world.stores.serialize(key))
                );

                this.player.storeOpen = key;

                break;
            }

            case 'aoe': {
                this.player.hit(600, this.player, 2);
                break;
            }

            case 'bank': {
                this.player.canAccessContainer = true;

                this.player.send(new NPCPacket(Opcodes.NPC.Bank, this.player.bank.serialize()));
                break;
            }

            case 'openbank': {
                let username = blocks.shift()!;

                if (!username)
                    return this.player.notify(`Malformed command, expected /openbank username`);

                let player = this.world.getPlayerByName(username);

                if (!player) return this.player.notify(`Could not find player: ${username}`);

                this.player.send(new NPCPacket(Opcodes.NPC.Bank, player.bank.serialize()));

                break;
            }

            case 'setrank': {
                if (this.player.isHollowAdmin()) return;

                let rankText = blocks.shift()!;

                username = blocks.join(' ');

                if (!username || !rankText)
                    return this.player.notify(`Malformed command, expected /setrank username rank`);

                player = this.world.getPlayerByName(username);

                if (!player)
                    return this.world.database.setRank(
                        username,
                        Modules.Ranks[rankText as keyof typeof Modules.Ranks]
                    );

                let rank = Modules.Ranks[rankText as keyof typeof Modules.Ranks];

                if (isNaN(rank)) return this.player.notify(`Invalid rank: ${rankText}`);

                player.setRank(rank);
                player.sync();

                break;
            }

            case 'setpet': {
                let key = blocks.shift()!;

                if (!key) return this.player.notify(`Malformed command, expected /setpet key`);

                this.player.setPet(key);

                break;
            }

            case 'opencrafting': {
                return this.world.crafting.open(this.player, Modules.Skills.Crafting);
            }

            case 'openalchemy': {
                return this.world.crafting.open(this.player, Modules.Skills.Alchemy);
            }

            case 'opencooking': {
                return this.world.crafting.open(this.player, Modules.Skills.Cooking);
            }

            case 'opensmithing': {
                return this.world.crafting.open(this.player, Modules.Skills.Smithing);
            }

            case 'opensmelting': {
                return this.world.crafting.open(this.player, Modules.Skills.Smelting);
            }

            case 'lootbag': {
                let items: Item[] = [
                    new Item('oldonesblade', -1, -1, false, 1),
                    new Item('froghelm', -1, -1, false, 1),
                    new Item('gold', -1, -1, false, 1500)
                ];

                this.world.entities.spawnLootBag(
                    this.player.x,
                    this.player.y,
                    this.player.username,
                    items
                );
                break;
            }

            case 'ipban': {
                let username = blocks.join(' ').toLowerCase();

                if (!username)
                    return log.info(`Malformed command, expected /${command} <username>`);

                let player = this.world.getPlayerByName(username);

                if (!player) return log.info(`Could not find player by name: ${username}.`);

                this.player.database.setIpBan(player.connection.address, command === 'ipban');

                this.player.notify(`Player ${player.username} has been IP banned`);

                for (let p of this.entities.getPlayersByIp(player.connection.address))
                    p.connection.reject('banned');

                break;
            }

            case 'countdown': {
                let time = parseInt(blocks.shift()!);

                if (!time) return this.player.notify(`Malformed command, expected /countdown time`);

                this.player.countdown(time);

                break;
            }

            case 'find': {
                let npc = this.world.entities.getNPCByKey(blocks.join(' '));

                this.player.notify(
                    npc
                        ? `Found NPC: ${npc.name} at x: ${npc.x}, y: ${npc.y}`
                        : `Could not find NPC.`
                );

                break;
            }

            case 'testitems': {
                this.player.bank.empty();

                for (let key in Items) this.player.bank.add(new Item(key, -1, -1, false, 100));

                break;
            }

            case 'collision': {
                let x = parseInt(blocks.shift()!) || this.player.x,
                    y = parseInt(blocks.shift()!) || this.player.y;

                if (!x || !y)
                    return this.player.notify(`Malformed command, expected /collision x y`);

                let index = this.world.map.coordToIndex(x, y);

                this.player.notify(`${this.world.map.isColliding(x, y)} - index: ${index}`);

                log.debug(`Data: ${this.world.map.data[index]}`);

                break;
            }

            case 'hide': {
                this.player.visible = !this.player.visible;

                if (this.player.visible) {
                    this.player.notify(`You are now visible.`);

                    this.player.sendToRegions(new SpawnPacket(this.player), true);
                } else {
                    this.player.notify(`You are now invisible.`);

                    this.player.sendToRegions(
                        new DespawnPacket({ instance: this.player.instance }),
                        true
                    );
                }

                break;
            }

            case 'tp': {
                let key = blocks.shift()!;

                switch (key) {
                    case 'home': {
                        return this.player.teleport(191, 166, true, false, true);
                    }

                    case 'underwater': {
                        return this.player.teleport(119, 290, true, false, true);
                    }

                    case 'underwatervolcano': {
                        return this.player.teleport(194, 427, true, false, true);
                    }

                    case 'kok': {
                        return this.player.teleport(290, 357, true, false, true);
                    }

                    case 'mountain': {
                        return this.player.teleport(440, 312, true, false, true);
                    }

                    case 'santa': {
                        return this.player.teleport(526, 256, true, false, true);
                    }

                    case 'ice': {
                        return this.player.teleport(608, 332, true, false, true);
                    }

                    case 'pink': {
                        return this.player.teleport(685, 433, true, false, true);
                    }

                    case 'hell': {
                        return this.player.teleport(1112, 787, true, false, true);
                    }

                    case 'sewer': {
                        return this.player.teleport(1117, 709, true, false, true);
                    }

                    case 'shroom': {
                        return this.player.teleport(992, 631, true, false, true);
                    }

                    case 'skeletonking': {
                        return this.player.teleport(120, 794, true, false, true);
                    }

                    case 'ogrelord': {
                        return this.player.teleport(342, 166, true, false, true);
                    }

                    case 'queenant': {
                        return this.player.teleport(591, 820, true, false, true);
                    }

                    case 'forestdragon': {
                        return this.player.teleport(457, 807, true, false, true);
                    }

                    case 'crystalcave': {
                        return this.player.teleport(886, 622, true, false, true);
                    }

                    case 'piratecaptain': {
                        return this.player.teleport(930, 752, true, false, true);
                    }
                }

                break;
            }

            case 'toggle': {
                let key = blocks.shift()!,
                    effect: Modules.Effects = Modules.Effects.None;

                switch (key) {
                    case 'cold':
                    case 'freeze':
                    case 'freezing': {
                        if (this.player.status.has(Modules.Effects.Freezing))
                            return this.player.status.remove(Modules.Effects.Freezing);

                        effect = Modules.Effects.Freezing;
                        break;
                    }

                    case 'fire':
                    case 'burn':
                    case 'burning': {
                        if (this.player.status.has(Modules.Effects.Burning))
                            return this.player.status.remove(Modules.Effects.Burning);

                        effect = Modules.Effects.Burning;
                        break;
                    }

                    case 'terror': {
                        if (this.player.status.has(Modules.Effects.TerrorStatus))
                            return this.player.status.remove(Modules.Effects.TerrorStatus);

                        effect = Modules.Effects.TerrorStatus;
                        break;
                    }

                    case 'stun': {
                        if (this.player.status.has(Modules.Effects.Stun))
                            return this.player.status.remove(Modules.Effects.Stun);

                        effect = Modules.Effects.Stun;
                        break;
                    }

                    case 'hide': {
                        return this.player.send(new CommandPacket({ command: 'hide' }));
                    }

                    default: {
                        return this.player.status.clear();
                    }
                }

                return this.player.status.addWithTimeout(effect, 60_000);
            }
        }
    }
}
